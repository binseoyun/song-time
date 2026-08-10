# 트러블슈팅 03: 회원 탈퇴 확인 버튼이 화면에 안 보이는 문제

- 발생일: 2026-08-10
- 관련: ADR-005(회원 탈퇴 기능), `doc/portfolio-roadmap.md`
- 영향 범위: `frontend/Course Registration Platform/src/components/MyPage.tsx`의 회원 탈퇴 확인 버튼(및 동일 섹션의 테두리/호버/포커스 스타일)

## 증상

k8s(kind)에 배포된 앱을 브라우저로 확인하던 중, 마이페이지 → 회원 탈퇴 → 비밀번호 입력 화면까지는 정상 진입했지만 **"정말 탈퇴합니다" 확인 버튼이 화면에 보이지 않았다.** "취소" 버튼만 보이고, 그 왼쪽에 있어야 할 확인 버튼 자리가 빈 공간처럼 보였다.

## 원인 분석

### 1차 확인: DOM에는 버튼이 있다

`read_page`(접근성 트리)로 확인한 결과, 문제의 버튼은 **DOM에 존재했고 텍스트("정말 탈퇴합니다")도 들어 있었다.** 즉 React 렌더링 자체는 정상 — 눈에만 안 보이는 상태였다.

### 2차 확인: 배경색이 투명하다

`getComputedStyle`로 실제 렌더링된 스타일을 확인:

```json
{
  "className": "px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 ...",
  "color": "rgb(255, 255, 255)",
  "backgroundColor": "rgba(0, 0, 0, 0)"
}
```

`bg-red-600` 클래스가 붙어 있는데도 `background-color`가 완전 투명이었다. `text-white`는 정상 적용되어 글자색은 흰색 → **흰 배경(카드) 위에 흰 글씨가 투명 배경 버튼에 찍힌 상태라 눈에 안 보였을 뿐, 클릭은 가능한 "유령 버튼"** 이었다.

### 근본 원인: Tailwind CSS가 빌드 파이프라인 없이 정적 스냅샷으로 커밋되어 있음

`frontend/.../src/index.css`(1,800줄 이상)는 Tailwind CLI가 생성한 실제 산출물이지만, `vite.config.ts`에는 `@tailwindcss/vite` 같은 빌드 플러그인이 없고 `postcss.config`도 없다. 즉 **이 CSS 파일은 최초 1회(팀 프로젝트 스냅샷 이관 커밋, `56fb3d8`) 생성된 뒤로 다시 컴파일된 적이 없는 정적 파일**이다.

```bash
$ git log --oneline -- frontend/.../src/index.css
56fb3d8 chore: 팀 프로젝트 스냅샷 초기 이관 (히스토리 제외)
```

이후 ADR-005(회원 탈퇴, 2026-08-04)에서 `bg-red-600`, `hover:bg-red-700`, `border-red-100`, `border-red-200`, `hover:bg-red-50`, `focus:ring-red-500` 같은 새 유틸리티 클래스를 컴포넌트에 추가했지만, CSS를 재생성하는 빌드 단계가 없으므로 **이 클래스들에 대응하는 규칙이 CSS에 한 번도 생성되지 않았다.** Tailwind의 색상 팔레트 변수(`--color-red-600` 등)는 `@theme`에 이미 정의돼 있어 `text-red-600`처럼 스냅샷 시점에 이미 쓰이던 클래스는 정상 동작했고, 그래서 문제가 "버튼 하나만 이상하다"는 국소적인 증상으로 나타나 원인 파악이 늦어질 뻔했다.

부수적으로 `--color-red-200` 변수 자체가 `@theme`에서 누락되어 있는 것도 함께 발견했다(빨간 계열 중 200 단계만 스냅샷 시점에 한 번도 쓰인 적이 없었던 것으로 추정).

### 검증: 실제로 빠진 규칙 확인

브라우저에서 로드된 스타일시트를 재귀 순회(Tailwind v4는 `@layer` 중첩을 쓰므로 최상위 `cssRules`만 보면 놓친다)해 직접 대조한 결과:

| 클래스 | 사용처 | CSS 규칙 존재 여부 |
|---|---|---|
| `.bg-red-600` | 확인 버튼 배경 | ❌ |
| `.hover\:bg-red-700` | 확인 버튼 hover | ❌ |
| `.border-red-100` | 카드 테두리 | ❌ |
| `.border-red-200` | 트리거 버튼 테두리 | ❌ |
| `.hover\:bg-red-50` | 트리거 버튼 hover | ❌ |
| `.focus\:ring-red-500` | 비밀번호 입력 포커스 링 | ❌ |

## 해결

정식 Tailwind 빌드 파이프라인을 새로 구성하는 대신(스코프 밖 — CLAUDE.md 원칙상 "새 기능 추가/대수술 금지"), **기존에 이미 이 파일에 있던 선례**(`.bg-red-50`, `.bg-red-500` 등이 같은 방식으로 수동 추가돼 있었음)를 따라 누락된 6개 유틸리티 규칙 + 1개 테마 변수(`--color-red-200`)를 Tailwind v4가 생성했을 값 그대로 수동 추가했다.

```css
.bg-red-600 { background-color: var(--color-red-600); }

.border-red-100 { border-color: var(--color-red-100); }
.border-red-200 { border-color: var(--color-red-200); }

.focus\:ring-red-500:focus { --tw-ring-color: var(--color-red-500); }

@media (hover: hover) {
  .hover\:bg-red-50:hover { background-color: var(--color-red-50); }
  .hover\:bg-red-700:hover { background-color: var(--color-red-700); }
}
```

`--color-red-200: oklch(.885 .062 18.334)` (Tailwind v4 공식 팔레트 값)도 `@theme` 블록에 추가.

이후 `npm run build`로 로컬 빌드가 CSS 문법 오류 없이 성공하는 것을 확인하고, `binseoyun/frontend:v7` 이미지로 빌드/푸시 → `K8s/40-frontend.yaml` 이미지 태그 `v6 → v7` → `kubectl apply` → rollout으로 실제 클러스터에 반영했다.

## Before / After

| 측정 | Before | After |
|---|---|---|
| 확인 버튼 `background-color` (computed) | `rgba(0, 0, 0, 0)` (투명) | `oklch(.577 .245 27.325)` (Tailwind red-600) |
| 누락된 관련 CSS 규칙 수 | 6개 (클래스) + 1개 (테마 변수) | 0개 |
| 육안 확인 | 버튼이 안 보임(취소 버튼만 보임) | 빨간 버튼 정상 표시 |

## 검증 중 발생한 부수 사고 (기록해두는 이유: 실패도 자산)

수정 전/후 버튼 위치를 스크린샷으로 비교하던 중, 상태 전환 애니메이션/스크롤 위치 착시로 "클릭이 안 먹었다"고 오판하고 같은 좌표를 재클릭했다. 실제로는 첫 클릭으로 이미 "탈퇴 확인" 화면이 열려 있었고, 재클릭 좌표가 하필 새로 보이게 된 확인 버튼 자리였다. 게다가 Chrome이 비밀번호 필드를 자동완성해 둔 상태였기 때문에, 재클릭 한 번으로 실제 탈퇴 API 호출까지 완료되어 테스트 계정이 즉시(하드 삭제 정책상 복구 불가) 삭제됐다.

**교훈**: 되돌릴 수 없는 액션(삭제/탈퇴 등)이 걸린 화면에서는, 클릭 전에 반드시 스크린샷/접근성 트리로 "지금 정확히 어떤 상태인가"를 재확인한다. 특히 자동완성으로 입력값이 미리 채워져 있는 폼 근처에서는 좌표 재사용을 피한다.

## 한계 인식

- 지금 방식(수동으로 CSS 규칙 추가)은 **땜질**이다. 이후 같은 패턴의 클래스가 또 추가되면 똑같은 문제가 재발한다. 근본 해결은 Tailwind 빌드 파이프라인(`@tailwindcss/vite` 플러그인 등)을 실제로 연결해 CSS가 소스 변경 시 자동 재생성되게 하는 것이며, 이는 현재 로드맵 스코프 밖이라 별도 이슈로 남긴다.
