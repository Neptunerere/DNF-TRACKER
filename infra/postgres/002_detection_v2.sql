alter table market_watch_items add column if not exists source_note text;
alter table anomaly_events add column if not exists confidence_score integer not null default 0;
alter table anomaly_events add column if not exists detector_version text not null default 'rule-v1';
alter table anomaly_events add column if not exists baseline_sample_count integer not null default 0;
alter table anomaly_events add column if not exists volume_ratio numeric(12,4);

insert into market_watch_items (item_name,priority,source_note) values
('+10 장비 증폭권[골고라이언]',100,'공개 시장 거래액 상위'),
('숲속의 유랑악단 패키지',100,'공개 시장 거래액 상위'),
('+7 장비 증폭권[골고라이언]',90,'공개 시장 거래액 상위'),
('플로럴 스태그 알',100,'공개 시장 거래액 상위'),
('닳아버린 순례의 증표',100,'공개 시장 거래액 상위'),
('열대야의 추억 오라 상자',90,'공개 시장 거래액 상위'),
('히스토리아 쿼츠',90,'공개 시장 검색 상위'),
('플로럴 스태그 플래티넘 크리쳐 알 선택 상자',90,'공개 시장 거래액 상위'),
('흑아 태초 변환서 - 칠흑의 정화',80,'공개 시장 검색 상위'),
('DNF X NBA 스페셜 상의 아바타 상자[무제한]',80,'공개 시장 시가총액 상위'),
('에픽 소울 결정',100,'복수 공개 사이트 가격 지표'),
('베히모스의 눈물(1회 교환 가능)',80,'공개 시장 검색 상위'),
('PC방 토큰 교환권',100,'공개 시장 거래량 상위'),
('+12 장비 증폭권[골고라이언]',100,'공개 시장 거래액 상위'),
('태초 소울 결정',100,'복수 공개 사이트 가격 지표'),
('광휘의 소울 결정',100,'복수 공개 사이트 가격 지표'),
('순례의 인장(1회 교환 가능)',100,'공개 시장 거래량 상위'),
('신비한 바인드 큐브 주머니',90,'공개 시장 거래액 상위'),
('적아 울라드 카드',90,'공개 시장 거래액 상위'),
('숲속의 유랑악단 크리쳐 상자',90,'공개 시장 거래액 상위'),
('+11 장비 증폭권[골고라이언]',90,'공개 시장 거래액 상위'),
('증폭 보호권',90,'공개 시장 거래액 상위'),
('실반 멜로디 카드',90,'공개 시장 거래액 상위'),
('땅지기 카메린 카드',90,'공개 시장 거래액 상위'),
('골드 코인',80,'공개 시장 시가총액 상위')
on conflict (item_name) do update set
  priority=greatest(market_watch_items.priority,excluded.priority),
  source_note=excluded.source_note,
  active=true;
