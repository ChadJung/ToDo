# ToDo

Electron 기반 데스크톱 Todo 앱. JOB(프로젝트) 단위로 Task를 관리하며 **보드 / 캘린더 / 목록** 세 가지 보기를 제공합니다.

## 주요 기능

### 3가지 보기 모드
- **보드** — JOB별 칸반 컬럼 (상태/우선순위 필터, 카드에서 직접 상태·우선순위 변경, 카드 우상단 `×` 버튼으로 바로 삭제, 컬럼 헤더 드래그&드롭으로 JOB 순서 변경)
- **캘린더** — 월/주 단위
  - 월 뷰: 다일자 일정은 **일체형 spanning bar**로 표시 (주 경계에서 자연스럽게 연결), 진행중 일정은 굵은 글씨로 강조, 주 row 높이에 따라 표시 일정 수가 실시간 조정
  - 주 뷰: 시간대별 그리드 (네이버 캘린더 스타일, 24시간 × 7일)
- **목록** — 전체 Task를 JOB 그룹별 테이블로 표시 (완료 항목은 항상 맨 아래로 정렬)

### 캘린더 인터랙션
- 마우스로 bar를 잡고 드래그 → 다른 날짜로 이동 (다른 주로도 이동 가능)
- bar 양 끝(좌/우 핸들)을 잡고 시작일·종료일 리사이즈
- 주 뷰에서 시간 그리드 위 일정을 상하/좌우로 드래그 → 시간·요일 동시 변경
- 위·아래 핸들로 시작·종료 시간 리사이즈 (15분 스냅)
- 빈 셀 더블클릭 → 해당 날짜/시간으로 Task 추가 모달

### 그 외
- **Task 속성**: 제목, 라벨(최대 10자), JOB, 상태(대기/진행/완료), 우선순위(높음/보통/낮음), 시작일·시간, 마감일, 종료일·시간, 메모
- **Task 라벨** — 제목 앞에 `[라벨]` 형태로 표시, 기존 라벨 드롭다운 선택 및 항목별 삭제
- **JOB별 색상** — JOB마다 프리셋 색상을 지정하면 보드 카드·컬럼·캘린더 일정에 반영 (미지정 시 상태 색상 유지)
- **시작 시간 알림** — 시스템 알림, 분 단위 사전 알림 시간 설정
- **확대/축소** — `Ctrl + 마우스휠` (본문 영역만, 3단계)
- **온보딩 투어** — 첫 실행 시 자동 안내 (JOB·Task 추가, 보기 모드, 캘린더, Task 입력 필드), 우상단 `?` 버튼으로 다시 보기
- **상태 자동화** — 완료 시 종료시간 자동 설정 정책 선택 가능 (매번 묻기 / 자동 / 수동)
- **Windows 자동 시작** — 첫 실행 시 1회 묻고, 설정 메뉴에서 언제든 토글
- **UI 상태 영구 보존** — 보기 모드, 필터, 정렬, 캘린더 모드

## 설치 및 실행

```bash
cd todo-app
npm install
npm start
```

## Windows 빌드

```bash
cd todo-app
npm run build           # NSIS installer
npm run build:portable  # portable exe
```

산출물은 `todo-app/dist/`에 생성됩니다. 빌드 시 `prebuild` 훅이 이전 `dist/`를 자동으로 비웁니다(`npm run clean`). electron-builder 캐시까지 정리하려면 `clean.bat`을 실행하세요.

### 자동 릴리스 (CI)

`v*` 태그를 푸시하면 `.github/workflows/release.yml`이 Windows 러너에서 NSIS + Portable을 빌드하고 `CHANGELOG.md`의 해당 버전 섹션을 release notes로 추출해 GitHub Release를 자동 생성·업로드합니다.

```bash
# CHANGELOG.md 에 "## [1.5.0] - YYYY-MM-DD" 섹션 추가 후
npm --prefix todo-app version 1.5.0 --no-git-tag-version
git add -A && git commit -m "release: v1.5.0"
git tag v1.5.0
git push --follow-tags
```

## 단축키

| 단축키 | 동작 |
| --- | --- |
| `1` / `2` / `3` | 보기 전환 (보드 / 캘린더 / 목록) |
| `Ctrl + Tab` | 보기 모드 순환 (보드 → 캘린더 → 목록) |
| `A` / `D` 또는 `←` / `→` | 캘린더 이전/다음 이동 |
| `Q` / `E` | 캘린더 월 / 주 전환 |
| `Ctrl + Q` | JOB 추가 |
| `Ctrl + E` | Task 추가 |
| `Ctrl + 마우스휠` | 본문 확대/축소 |
| `Esc` | 모달/팝업 닫기 |

## 프로젝트 구조

```
todo-list/
├─ todo-app/
│  ├─ main.js              # Electron main process
│  ├─ preload.js           # IPC bridge (todoAPI / settingsAPI / notifyAPI / windowAPI)
│  ├─ renderer/
│  │  ├─ index.html        # UI 마크업
│  │  ├─ app.js            # 모든 렌더러 로직 (state, render, drag, datepicker, tour ...)
│  │  ├─ styles.css        # 전체 스타일
│  │  └─ splash.html       # 스플래시 화면
│  ├─ data/                # 로컬 todo 데이터 (gitignored)
│  ├─ clean.bat            # 빌드 캐시 정리 스크립트
│  └─ package.json
├─ CHANGELOG.md
└─ README.md
```

## 데이터 저장

- todo 데이터는 main 프로세스가 JSON 파일로 관리하며 사용자 머신에 저장됩니다.
- 로컬 `todo-app/data/`는 개발용으로만 사용되며 저장소에는 추적되지 않습니다.

## 기술 스택

- [Electron](https://www.electronjs.org/) 33
- Vanilla JavaScript / HTML / CSS (외부 프레임워크 없음)
- [electron-builder](https://www.electron.build/) 25 (NSIS / portable)

## 향후 과제 (Roadmap)

- [ ] **다국어 지원 (i18n)** — 한국어 기본, 설정 모달에서 언어 전환. 후보: ko / en / ja / zh (필요 시 es / fr 추가). 데이터 저장 값(status/priority)은 한글 그대로 유지하고 화면 라벨만 번역하는 방식.
- [ ] Google Calendar 양방향 동기화 (OAuth 2.0)
- [ ] 데모 GIF 추가 (캘린더 드래그/리사이즈, 보기 전환)

## 라이선스

MIT
