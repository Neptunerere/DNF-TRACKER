# DNF Tracker

던전앤파이터 Open API의 경매장 데이터를 수집해 가격·물량의 이상 징후를 탐지하고, 분석가가 확인할 사건의 우선순위를 정할 수 있도록 만든 보안분석 포트폴리오 프로젝트입니다.

> 탐지 결과는 부정행위 판정이 아닌 추가 조사가 필요한 이상 징후입니다.

## 주요 기능

- 105개 Watchlist 아이템 주기적 수집
- 거래 중앙값과 MAD 기반 가격 편차 분석
- 가격 급등락, 물량 증가, 반복 가격대, 대량 등록 탐지
- Risk Score와 데이터 신뢰도 분리
- 반복 신호를 대표 사건으로 통합
- 가격 구간을 사건 상세의 하위 증거로 제공
- 담당자, 분석 메모, 오탐 사유 및 조사 상태 관리
- 탐지 규칙 백테스트와 게임 이벤트 억제 구간
- 업데이트·이벤트·CM 피드백 및 후속 대응 관리

대표 사건은 다음 기준으로 집계합니다.

```
아이템 + 탐지 유형 + 가격 방향 + 최근 30분 활동
```

## 데이터 한계

공개 API에서는 계정 관계, 골드 이동 경로, 실제 정책 위반 여부를 확인할 수 없습니다.

따라서 이 프로젝트는 부정행위를 자동으로 판단하지 않으며, 분석가가 심층 조사할 후보를 선별하는 역할에 집중합니다.

기술 스택
- Frontend: React 19, Vinext, TypeScript, TanStack Table
- Backend: Node.js, Express
- Database: PostgreSQL
- Infrastructure: Docker Compose

## 실행

프로젝트 루트에 NEOPLE_API_KEY를 설정한 뒤 실행합니다.

```
docker compose up --build -d
```

- 대시보드: http://localhost:3000
- 시장 API: http://localhost:4000
- 상태 확인: http://localhost:4000/health

```
docker compose logs -f collector-worker market-api
```

수집 데이터는 Docker Volume에 저장되므로 컨테이너를 재시작해도 유지됩니다.