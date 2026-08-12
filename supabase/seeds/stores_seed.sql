insert into public.stores (
  market_name,
  store_name,
  owner_name,
  category,
  description
)
values
  (
    '양동시장',
    '준서네 반찬',
    '김준서',
    '반찬가게',
    '집밥 느낌 반찬과 당일 조리 반찬을 판매하는 가게'
  ),
  (
    '양동시장',
    '명가 분식',
    '박민수',
    '분식집',
    '떡볶이, 김밥, 튀김 등 분식 메뉴를 판매하는 가게'
  ),
  (
    '대인시장',
    '바다횟집',
    '이수연',
    '횟집',
    '활어회와 해산물 메뉴를 판매하는 가게'
  )
on conflict (market_name, store_name) do nothing;
