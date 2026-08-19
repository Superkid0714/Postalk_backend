alter table public.generation_jobs
  drop constraint if exists generation_jobs_style_preset_check;

alter table public.generation_jobs
  add constraint generation_jobs_style_preset_check
  check (
    style_preset in (
      'menu_highlight',
      'clean_poster',
      'market_story',
      'food_card_news'
    )
  );
