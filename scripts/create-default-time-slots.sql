-- 建立預設時段配置
-- 這個腳本會在 schedule_time_slots 表中建立三個預設時段

-- 早上時段 (09:00-12:00)
INSERT INTO schedule_time_slots (
  id,
  name,
  start_hour,
  start_minute,
  end_hour,
  end_minute,
  allowed_template_ids,
  active_days,
  enabled,
  priority
) VALUES (
  UUID(),
  '早上時段',
  9,
  0,
  12,
  0,
  '[]',
  '[1,2,3,4,5,6,7]',
  1,
  1
);

-- 下午時段 (13:00-17:00)
INSERT INTO schedule_time_slots (
  id,
  name,
  start_hour,
  start_minute,
  end_hour,
  end_minute,
  allowed_template_ids,
  active_days,
  enabled,
  priority
) VALUES (
  UUID(),
  '下午時段',
  13,
  0,
  17,
  0,
  '[]',
  '[1,2,3,4,5,6,7]',
  1,
  2
);

-- 晚上時段 (18:00-21:00)
INSERT INTO schedule_time_slots (
  id,
  name,
  start_hour,
  start_minute,
  end_hour,
  end_minute,
  allowed_template_ids,
  active_days,
  enabled,
  priority
) VALUES (
  UUID(),
  '晚上時段',
  18,
  0,
  21,
  0,
  '[]',
  '[1,2,3,4,5,6,7]',
  1,
  3
);
