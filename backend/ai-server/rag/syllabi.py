"""syllabi.yaml 로드 · 검증 · 청크 텍스트 빌드 · point ID.

파싱 방식 A3(ADR-010 §6 재검토): YAML 자체가 청크 단위(사람이 분반 병합을 이미
적용, `class_no`는 배열). 로더는 파싱하지 않고 검증·임베딩·upsert만 한다.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Any

import yaml

from .config import SYLLABI_YAML, UUID_NAMESPACE

_COURSE_CODE_RE = re.compile(r"^\d{8}$")
_REQUIRED = (
    "course_code", "class_no", "course_name", "professor", "professor_email",
    "department", "credits", "method", "teaching_methods", "prerequisites",
    "textbook", "reference", "exam_schedule", "overview", "objectives",
    "grading", "weekly_plan", "source_pdf",
)


class SyllabusValidationError(ValueError):
    """스키마 검증 실패 — 어느 항목의 어떤 필드가 왜 틀렸는지 메시지에 담는다."""


@dataclass
class Syllabus:
    course_code: str
    class_no: list[str]
    course_name: str
    professor: str
    professor_email: str
    department: str
    credits: int
    method: str
    teaching_methods: list[str]
    prerequisites: str
    textbook: str
    reference: str
    exam_schedule: str
    overview: str
    objectives: str
    grading: list[dict[str, Any]]
    weekly_plan: list[dict[str, Any]]
    source_pdf: list[str]
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def chunk_key(self) -> str:
        """사람이 읽는 point 식별자 — `"21000549__1"` (min class_no)."""
        return f"{self.course_code}__{min(self.class_no, key=int)}"

    @property
    def point_id(self) -> str:
        """Qdrant point ID. uuid5(고정 NS, chunk_key) — 결정론적, wipe-and-reload 안전."""
        return str(uuid.uuid5(uuid.UUID(UUID_NAMESPACE), self.chunk_key))

    @property
    def class_codes(self) -> list[str]:
        """`["21000549-1", "21000549-2"]` — 페이로드엔 저장 안 함, 응답에서 파생(§13)."""
        return [f"{self.course_code}-{n}" for n in self.class_no]

    def embedding_text(self) -> str:
        """임베딩 본문 (ADR-010 §13): 메타 헤더 + 개요 + 목표 + 선수 + 강의방법 + 주차별 주제.

        메타 헤더를 맨 앞에 둬 청크 하나만 top-k에 떠도 과목 식별이 가능하게 한다.
        """
        weeks = "\n".join(f"{w['week']}주차: {w['theme']}" for w in self.weekly_plan)
        methods = ", ".join(self.teaching_methods)
        prereq = self.prerequisites or "없음"
        return (
            f"과목명: {self.course_name} ({self.course_code})\n"
            f"담당교수: {self.professor}\n"
            f"학과: {self.department} | 학점: {self.credits}\n\n"
            f"교과목 개요:\n{self.overview.strip()}\n\n"
            f"교육목표:\n{self.objectives.strip()}\n\n"
            f"선수과목: {prereq}\n"
            f"강의방법: {methods}\n\n"
            f"주차별 진도계획:\n{weeks}"
        )

    def payload(self) -> dict[str, Any]:
        """Qdrant 페이로드 (ADR-010 §13 재검토 스키마). grading/weekly_plan은 네이티브 JSON."""
        return {
            "course_code": self.course_code,
            "class_no": self.class_no,
            "professor": self.professor,
            "professor_email": self.professor_email,
            "course_name": self.course_name,
            "department": self.department,
            "credits": self.credits,
            "method": self.method,
            "teaching_methods": self.teaching_methods,
            "textbook": self.textbook,
            "reference": self.reference,
            "prerequisites": self.prerequisites,
            "grading": self.grading,
            "weekly_plan": self.weekly_plan,
            "exam_schedule": self.exam_schedule,
            "overview": self.overview.strip(),
            "objectives": self.objectives.strip(),
            "source_pdf": self.source_pdf,
            "chunk_key": self.chunk_key,
        }


def _validate_entry(idx: int, e: dict[str, Any]) -> None:
    where = f"[{idx}]"
    if not isinstance(e, dict):
        raise SyllabusValidationError(f"{where} 항목이 매핑이 아님")
    code = e.get("course_code")
    if isinstance(code, str) and _COURSE_CODE_RE.match(code):
        where = f"{code}"
    missing = [k for k in _REQUIRED if k not in e]
    if missing:
        raise SyllabusValidationError(f"{where} 필수 필드 누락: {', '.join(missing)}")

    if not _COURSE_CODE_RE.match(str(code)):
        raise SyllabusValidationError(f"{where} course_code 는 숫자 8자리여야 함 (받음: {code!r})")

    class_no = e["class_no"]
    if not isinstance(class_no, list) or not class_no:
        raise SyllabusValidationError(f"{where} class_no 는 비어있지 않은 배열이어야 함")
    for n in class_no:
        if not isinstance(n, str) or not n.isdigit() or n != n.lstrip("0") or n == "":
            raise SyllabusValidationError(
                f"{where} class_no 원소는 패딩 없는 숫자 문자열이어야 함 "
                f'(예: "1", "12" — "001" 아님). 받음: {n!r}'
            )

    if not isinstance(e["credits"], int) or e["credits"] <= 0:
        raise SyllabusValidationError(f"{where} credits 는 양의 정수여야 함 (받음: {e['credits']!r})")

    grading = e["grading"]
    if not isinstance(grading, list) or not grading:
        raise SyllabusValidationError(f"{where} grading 은 비어있지 않은 배열이어야 함")
    total = 0
    for g in grading:
        if not isinstance(g, dict) or "type" not in g or "weight" not in g:
            raise SyllabusValidationError(f"{where} grading 원소는 {{type, weight}} 여야 함: {g!r}")
        if not isinstance(g["weight"], (int, float)):
            raise SyllabusValidationError(f"{where} grading weight 는 숫자여야 함: {g!r}")
        total += g["weight"]
    if round(total, 3) != 100:
        raise SyllabusValidationError(
            f"{where} grading weight 합이 100이 아님 (합계 {total}): "
            f"{[(g['type'], g['weight']) for g in grading]}"
        )

    # 대부분 15주. 집중학기 과목(예: 영상정보처리)은 실제 수업 주가 더 적으므로
    # "15주 정확히"가 아니라 "1..15주, 1부터 연속, theme 비어있지 않음"으로 검증한다
    # (ADR-010 §13 재검토 — A3 정독 결과 반영). 8주 미만이면 전사 누락을 의심해 실패.
    weekly = e["weekly_plan"]
    if not isinstance(weekly, list) or not (8 <= len(weekly) <= 15):
        raise SyllabusValidationError(
            f"{where} weekly_plan 은 8~15주여야 함 (받음: {len(weekly) if isinstance(weekly, list) else weekly!r})"
        )
    for i, w in enumerate(weekly, start=1):
        if not isinstance(w, dict) or w.get("week") != i or not str(w.get("theme", "")).strip():
            raise SyllabusValidationError(
                f"{where} weekly_plan[{i}] 은 {{week: {i}, theme: <비어있지 않음>}} 여야 함: {w!r}"
            )

    for k in ("teaching_methods", "source_pdf"):
        if not isinstance(e[k], list) or not e[k]:
            raise SyllabusValidationError(f"{where} {k} 는 비어있지 않은 배열이어야 함")

    for k in ("course_name", "professor", "professor_email", "department",
              "method", "textbook", "overview", "objectives", "exam_schedule"):
        if not isinstance(e[k], str) or not e[k].strip():
            raise SyllabusValidationError(f"{where} {k} 는 비어있지 않은 문자열이어야 함")
    if "@" not in e["professor_email"]:
        raise SyllabusValidationError(f"{where} professor_email 형식이 이상함: {e['professor_email']!r}")
    if not isinstance(e["prerequisites"], str):
        raise SyllabusValidationError(f"{where} prerequisites 는 문자열이어야 함 (없으면 \"\")")


def _check_cross_entry(items: list[Syllabus]) -> list[str]:
    """엔트리 간 정합성 경고 (에러 아님) — 병합 누락·중복 감지."""
    warnings: list[str] = []
    seen_keys: dict[str, str] = {}
    seen_class: dict[str, str] = {}
    for s in items:
        if s.point_id in seen_keys:
            warnings.append(f"{s.chunk_key}: point_id 충돌 ({seen_keys[s.point_id]} 과 동일)")
        seen_keys[s.point_id] = s.chunk_key
        for full in s.class_codes:
            if full in seen_class:
                warnings.append(f"{full}: {s.chunk_key} 와 {seen_class[full]} 두 청크에 중복 등장")
            seen_class[full] = s.chunk_key
    # 같은 course_code + professor + 동일 본문인데 별도 엔트리로 남아있으면 병합 누락
    by_body: dict[tuple[str, str, str], str] = {}
    for s in items:
        key = (s.course_code, s.professor, " ".join(s.embedding_text().split()))
        if key in by_body:
            warnings.append(
                f"{s.chunk_key}: {by_body[key]} 와 course_code·교수·본문이 동일 — 병합 누락 의심"
            )
        by_body[key] = s.chunk_key
    return warnings


def load(path=None) -> list[Syllabus]:
    """syllabi.yaml 로드 + 검증. 실패 시 SyllabusValidationError."""
    path = path or SYLLABI_YAML
    with open(path, encoding="utf-8") as f:
        doc = yaml.safe_load(f)
    if not isinstance(doc, dict) or "syllabi" not in doc:
        raise SyllabusValidationError("최상위에 'syllabi:' 키가 있어야 함")
    entries = doc["syllabi"]
    if not isinstance(entries, list) or not entries:
        raise SyllabusValidationError("'syllabi:' 는 비어있지 않은 리스트여야 함")

    for i, e in enumerate(entries):
        _validate_entry(i, e)

    items = [
        Syllabus(**{k: e[k] for k in _REQUIRED}, raw=e)  # type: ignore[arg-type]
        for e in entries
    ]
    return items
