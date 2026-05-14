# Changelog

이 프로젝트의 주요 변경사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전은 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 사용합니다.

## [Unreleased]

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

[Unreleased]: https://github.com/ChadJung/ToDo/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/ChadJung/ToDo/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/ChadJung/ToDo/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ChadJung/ToDo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ChadJung/ToDo/releases/tag/v1.0.0
