"""syllabi.yaml 스키마 검증 — 독립 실행.

A3(수기 YAML)의 유일한 실질 리스크는 사람의 전사 오류다(ADR-010 §6 재검토).
필수 필드 존재 / course_code `^\\d{8}$` / grading weight 합 100 / weekly_plan 15주 /
class_no 패딩 없음 등을 싸게 잡는다. ingest.py 도 적재 전 이 검증을 호출한다.

    python -m rag.validate_syllabi
"""
from __future__ import annotations

import sys

from .syllabi import SyllabusValidationError, _check_cross_entry, load


def main() -> int:
    try:
        items = load()
    except SyllabusValidationError as exc:
        print(f"✗ 검증 실패: {exc}")
        return 1
    except FileNotFoundError:
        print("✗ syllabi.yaml 이 없습니다.")
        return 1

    warnings = _check_cross_entry(items)
    for w in warnings:
        print(f"⚠ {w}")

    total_classes = sum(len(s.class_no) for s in items)
    codes = sorted({s.course_code for s in items})
    print(f"✓ {len(items)}개 청크 / {total_classes}개 분반 / {len(codes)}개 과목코드 — 스키마 OK")
    for s in items:
        merged = f"  (병합 {s.class_no})" if len(s.class_no) > 1 else ""
        print(f"   {s.chunk_key:16} {s.course_name} — {s.professor}{merged}")
    return 1 if warnings else 0


if __name__ == "__main__":
    sys.exit(main())
