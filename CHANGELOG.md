# Changelog

이 프로젝트의 주요 변경사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전은 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 사용합니다.

## [Unreleased]

## [1.5.0] - 2026-06-26

### Added
- 시스템 트레이 최소화(minimize-to-tray) 기능 — 창을 닫을 때 종료하지 않고 트레이로 숨길 수 있음
  - 최초 닫기 시 "종료 / 트레이로 최소화"를 묻는 확인 모달 표시, 선택은 설정에 저장(tri-state)
  - 설정에서 토글 가능하며, 플래그 상태에 맞춰 트레이 아이콘을 생성/제거
  - 트레이 더블클릭/클릭으로 창 복원, 트레이 메뉴의 "종료"로 완전 종료

### Changed
- 필터가 적용된 상태에서 일치하는 Task가 하나도 없는 JOB은 컬럼/리스트 그룹 자체를 숨김 (기존엔 "필터에 일치하는 Task 없음" 빈 영역을 표시했음). 필터가 없을 때는 빈 JOB도 그대로 노출

## [1.4.7] - 2026-05-21

### Fixed
- 릴리스(GitHub Actions) 빌드가 기본 Electron 아이콘으로 나오던 문제 — `build/`가 통째로 `.gitignore`되어 앱 아이콘(`build/icon.ico`)이 저장소에 올라가지 않아 CI 빌드에 아이콘이 없었음. `build/`는 electron-builder의 출력이 아니라 입력(소스 자산) 디렉토리이므로, 생성물은 무시하되 `icon.ico`는 추적되도록 `.gitignore` 수정 + 아이콘 파일 커밋
  - 로컬 빌드는 로컬 `build/icon.ico`를 써서 정상이었으나, 배포본(CI)만 기본 아이콘으로 나오던 차이

## [1.4.6] - 2026-05-20

### Added
- JOB 번호(jobNo) 편집 기능 — 기존엔 생성 후 변경 불가(편집 모드에서 잠김)였으나 이제 수정 가능. 다른 JOB과 중복되는 번호는 거부하며, 변경 시 해당 JOB의 Task는 그대로 유지

### Changed
- JOB 컬럼 드래그로 순서를 바꿀 때 컬럼도 FLIP 애니메이션으로 부드럽게 이동 (기존엔 안의 카드만 애니메이션되고 컬럼 보드는 즉시 점프했음)
  - 이동한 컬럼 + 밀려나는 컬럼 모두 280ms ease-out으로 슬라이드
  - 이동한 컬럼 내부의 카드는 개별 애니메이션을 건너뜀 — 컬럼 transform이 카드를 함께 옮기므로 이중 애니메이션 방지

### Fixed
- 최초 실행 시 창이 최소 너비(1360px)보다 좁게 열리던 문제 — 기본 너비가 1200px로 minWidth보다 작았음. 기본값을 1400×860으로 올리고, 저장된 창 상태도 로드 시 최소 크기로 clamp (구버전이 저장한 1200px 상태 보정)

## [1.4.5] - 2026-05-20

### Fixed
- JOB 컬럼을 가장 우측으로 드래그할 때 삽입선은 우측에 표시되지만 실제로 이동되지 않던 문제
  - 원인: drag/drop 핸들러가 컬럼별로 붙어 있어, 커서가 마지막 컬럼을 지나 보드 우측 패딩/빈 영역에 놓이면 어느 컬럼의 `drop`도 발생하지 않음
  - drag/drop을 보드 레벨 위임으로 변경하고, 커서 X로 삽입 지점을 계산(`getDragInsertionPoint`) → 컬럼 사이 갭·우측 끝 어디에 놓아도 정상 삽입

## [1.4.4] - 2026-05-20

### Fixed
- 스플래시 화면이 닫히기도 전에 메인 창이 떠버리던 문제
  - 원인: 창 생성 직후 `win.maximize()`를 호출했는데, `show: false` 상태의 창을 Windows에서 maximize하면 즉시 보여버림 → 이전 세션이 최대화 상태였던 사용자에게 splash보다 메인 창이 먼저 노출
  - maximize 호출을 창 표시 시점(`revealWindow`)으로 이동
  - 메인 창은 splash의 `closed` 이벤트 이후에만 표시하도록 변경 → 두 창이 화면에서 겹치지 않음 (둘 다 `#1e1e1e` 배경이라 전환이 매끄러움)

## [1.4.3] - 2026-05-20

### Security
- 개발자 개인 Todo 데이터(`data/todos.json`)가 빌드에 함께 포함되어 모든 사용자에게 배포되던 문제 수정
  - `files` 배열에서 `data/**` 제거 (패키지된 앱은 userData에서만 데이터를 읽으므로 asar 내 data는 불필요했음)
  - seed를 빈 파일(`build/seed-todos.json` = `{ "jobs": [] }`)로 분리하고 extraResources가 이를 복사하도록 변경

### Added
- `%TEMP%/TodoApp-startup.log` 크래시 안전 폴백 로그 — userData 접근 이전, app 준비 이전에 실행되어 "앱이 안 켜지고 로그도 없다" 상황에서 확인할 수 있는 최후의 진단 파일 (64KB cap, tail-trim rotation)
- 프로세스 시작 즉시 pid / electron 버전 / exe 경로 / argv 기록
- 단일 인스턴스 락 실패 기록 (좀비 프로세스로 인한 조용한 종료 구분)
- 실제 `userData` 경로를 boot 로그에 기록 (경로 혼동 방지)

### Known Issues
- 일부 PC에서 "ffmpeg.dll 없음" 오류로 실행 실패: AhnLab Safe Transaction 등 보안 소프트웨어가 미서명 Electron의 `ffmpeg.dll`을 오탐·격리하는 것이 원인. `ffmpeg.dll`은 Electron 런타임 부팅에 필수라 제거할 수 없으므로(제거 시 모든 PC에서 동일 오류 발생), 근본 해결책은 **코드 서명(Authenticode)**. 임시방편으로는 AhnLab 격리함에서 복원 + 예외 등록, 또는 AhnLab 오탐 신고.

## [1.4.2] - 2026-05-18

### Fixed
- 일부 사용자 PC에서 프로세스는 실행되지만(작업관리자에는 보임) 창이 테두리만 나오고 콘텐츠가 그려지지 않던 문제
  - 무조건 호출되던 `app.disableHardwareAcceleration()`이 일부 Windows 환경의 소프트웨어 컴포지팅을 깨뜨리는 원인이었음 → **기본 GPU 가속 ON**으로 복원
  - 필요 시 opt-out: CLI `--disable-gpu` / `--no-hwaccel`, 환경변수 `TODOAPP_DISABLE_GPU=1`, 또는 `%APPDATA%/TodoApp/disable-gpu.flag` 파일 생성
- 스플래시 창 옵션 `paintWhenInitiallyHidden: false` 제거 — `show: true`와 충돌해 첫 페인트가 지연되던 케이스 해소
- 스플래시 창에도 `did-fail-load` / `render-process-gone` 핸들러 추가

### Added
- 영구 앱 로그 `%APPDATA%/TodoApp/app.log`
  - 일반 모드: 최대 64KB, 32KB tail-trim rotation, `BOOT`/`WARN`/`ERROR`만 기록
  - 디버그 모드: 최대 1MB, 512KB tail-trim rotation, `INFO`까지 모두 기록
  - 디버그 모드 opt-in: CLI `--debug`, 환경변수 `TODOAPP_DEBUG=1`, 또는 `%APPDATA%/TodoApp/debug.flag` 파일
- `console.error` / `console.warn`을 자동으로 `app.log`에 미러링 — 기존 IPC 핸들러 실패가 코드 수정 없이 모두 기록됨
- `uncaughtException` / `unhandledRejection` 캡처

## [1.4.1] - 2026-05-15

### Fixed
- 캘린더: `endDate`만 있는 Task(완료 타임스탬프)가 잘못 표시되던 버그 — `taskSpan`이 `startDate`/`dueDate` 없으면 null 반환
- 캘린더 드래그/리사이즈 핸들러의 `mousemove`/`mouseup` document 리스너가 throw 경로에서 해제되지 않던 메모리 누수 (`try/finally` 적용, 월·주 모두)
- 보드 카드 상태/우선순위 변경 시 디스크 저장 실패가 조용히 사라지던 문제 — `fireAndForget` 헬퍼로 `showAlert` 노출
- 잘못된 `job.color` 값이 `style.background`에 그대로 흘러가던 CSS 인젝션 통로 — `sanitizeColor`로 `#RGB`/`#RRGGBB` 화이트리스트 검증
- 9곳의 빈 `catch (_) {}` → `console.warn`으로 진단 가능하게 변경

### Changed
- 보드 카드 클릭 핸들러를 `els.board` 단일 위임 리스너로 통합 (status/priority/delete/edit-job/delete-job/card-click). 렌더당 ~수백 개 리스너 재등록 제거
- JOB 컬럼 드래그 정렬: 컬럼 outline → **컬럼 사이 gap에 파란 세로선**으로 삽입 지점 명시
- 보드 카드 정렬 변경 시 **FLIP 애니메이션** 적용 — 상태/우선순위 변경 등으로 재정렬되는 카드와 영향받아 이동하는 카드 모두 280ms ease-out으로 부드럽게 이동

## [1.4.0] - 2026-05-15

### Added
- Windows 시작 시 자동 실행 기능
  - 최초 실행 시 모달로 한 번 묻고 사용자 선택을 저장 (`settings.autoStart`)
  - 설정 메뉴 "시스템" 섹션에 상시 토글 추가
  - 이후 실행 때마다 OS의 로그인 아이템 상태와 동기화 (작업관리자 등에서 외부로 OFF되면 설정에도 반영)

## [1.3.0] - 2026-05-15

### Added
- 보드 컬럼 드래그&드롭 정렬 - JOB 컬럼 헤더를 잡고 드래그하여 순서 변경 (저장됨)
- 월 캘린더 동적 lane 수 - 주 row 높이에 맞춰 표시 가능한 일정 수와 "+N 더보기" 라벨이 실시간으로 재계산 (창 resize/zoom 시 자동 갱신)

### Changed
- 보드·목록: 완료된 Task는 정렬 방향과 관계없이 항상 맨 아래로 정렬
- 캘린더: 진행중(`진행`) 일정은 굵은 글씨로 표시하여 대기와 시각적으로 구분
- 캘린더 줌 반영 - 월/주 일정 바 글씨·높이, 날짜 숫자, 셀 padding, JS의 LANE_H/HOUR_PX가 모두 `--zoom` 배율로 스케일되고 zoom 변경 시 캘린더가 즉시 재렌더링
- 캘린더 일정 바 시작 모서리 노치 제거 - `border-left` 대신 `box-shadow: inset 3px 0 0`을 사용해 `border-radius`를 따라 부드럽게 둥글어짐 (월/주/종일 모두)
- 확대 배율 toast 위치를 우상단 → 창 가로 중앙(헤더 아래)으로 이동
- 최소 창 크기 `minWidth: 1360 / minHeight: 720` - 보드 JOB 4개 + 월 캘린더 최대 줌 기준

### Fixed
- 완료 → 진행 되돌리기 후 다시 완료 시 종료시간 팝업이 뜨지 않던 문제 - 완료 상태에서 빠질 때 `endDate`/`endTime` 자동 초기화 (보드 카드 + Task 모달 모두)
- 보드 카드 hover 시 `translateY(-2px)`로 생긴 2px 빈 영역에 커서가 놓이면 hover가 ON/OFF로 깜빡이던 문제 - `::after`로 hit-test 영역을 메워 안정화

## [1.2.0] - 2026-05-14

### Added
- JOB별 색상 지정 - JOB 추가/수정 모달에서 프리셋 색상 팔레트(10색 + 없음) 선택
- 보드 컬럼 헤더에 JOB 수정 버튼(✎) - 제목과 색상을 변경할 수 있는 편집 모드

### Changed
- JOB 색상이 보드 카드 왼쪽 테두리, 컬럼 상단 띠, 캘린더 일정 bar(월간/주간/종일)에 반영됨
- 색상을 지정하지 않은 JOB은 기존 상태(대기/진행/완료) 색상을 그대로 사용 (하위 호환)

## [1.1.1] - 2026-05-14

### Changed
- Task 모달 레이아웃 정리: JOB 선택을 단독 행으로, 우선순위와 상태를 같은 행으로 배치
- 온보딩 투어 4번 스텝 제목을 화면 순서에 맞춰 "우선순위 & 상태"로 변경

### Fixed
- 상태 필터 드롭다운(`#filter-status`) 화살표를 나머지 드롭다운과 동일한 SVG 체브론으로 통일

### Added
- `clean.bat` - 빌드 전 `dist/` 및 electron-builder 캐시 정리 스크립트

## [1.1.0] - 2026-05-14

### Added
- 캘린더 뷰 (월간 / 주간) - 주간은 네이버 캘린더 스타일 시간대 그리드
- 캘린더 일정 bar 드래그/리사이즈 - 주 경계를 넘는 이동 및 기간 조절, 실시간 미리보기
- Task 라벨 기능 (최대 10자) - `[라벨] 제목` 형태 표시, 드롭다운 선택 및 항목별 삭제
- 온보딩 투어 - Task 모달을 열어 라벨·우선순위·상태·일정 입력 필드를 단계별로 안내
- 보드 카드 우측 상단 삭제 버튼 (호버 시 표시)
- 키보드 단축키 - 뷰 전환(1/2/3), 캘린더 이동(A/D, 화살표), 월/주 전환(Q/E)

### Changed
- 뷰 토글 순서를 보드 / 캘린더 / 목록으로 변경
- 주간 캘린더 제목 포맷 정규화 (중복되는 월·연도 생략)

### Fixed
- 실행 안정성 개선 - GPU 하드웨어 가속 비활성화, 단일 인스턴스 잠금,
  `ready-to-show` 미발생 시 강제 표시 fallback, `did-fail-load` / `render-process-gone` 핸들러

## [1.0.0] - 2026-05-14

### Added
- JOB > Tasks 데이터 모델 기반 Electron 데스크톱 Todo 앱 최초 릴리스
- 보드 뷰 (JOB별 칸반) 및 목록 뷰 (전체 Task 테이블)
- Task 상태(대기/진행/완료), 우선순위, 시작/마감/종료 일정 관리
- 네이티브 알림, 창 상태 유지, 확대/축소

[Unreleased]: https://github.com/ChadJung/ToDo/compare/v1.4.7...HEAD
[1.4.7]: https://github.com/ChadJung/ToDo/compare/v1.4.6...v1.4.7
[1.4.6]: https://github.com/ChadJung/ToDo/compare/v1.4.5...v1.4.6
[1.4.5]: https://github.com/ChadJung/ToDo/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/ChadJung/ToDo/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/ChadJung/ToDo/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/ChadJung/ToDo/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/ChadJung/ToDo/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/ChadJung/ToDo/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/ChadJung/ToDo/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/ChadJung/ToDo/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/ChadJung/ToDo/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ChadJung/ToDo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ChadJung/ToDo/releases/tag/v1.0.0
