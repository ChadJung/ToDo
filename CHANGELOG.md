# Changelog

이 프로젝트의 주요 변경사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전은 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 사용합니다.

## [Unreleased]

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

[Unreleased]: https://github.com/ChadJung/ToDo/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/ChadJung/ToDo/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/ChadJung/ToDo/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/ChadJung/ToDo/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/ChadJung/ToDo/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ChadJung/ToDo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ChadJung/ToDo/releases/tag/v1.0.0
