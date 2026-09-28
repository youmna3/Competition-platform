-- The rubric immutability guard is shared by rubric_templates and its child
-- tables.  The original implementation referenced OLD.lifecycle before
-- narrowing to rubric_templates, which fails for child rows because they do
-- not have a lifecycle column.  Keep the same protections, but select fields
-- only from the row shape that belongs to the triggering table/operation.
create or replace function public.guard_rubric_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template text;
  v_state public.rubric_lifecycle;
begin
  if tg_table_name = 'rubric_templates' then
    if tg_op = 'DELETE' then
      v_template := old.id;
    else
      v_template := new.id;
    end if;

    if tg_op = 'UPDATE' then
      if old.lifecycle = 'published'
         and new.lifecycle = 'archived'
         and (to_jsonb(new) - array['lifecycle', 'updated_at'])
             = (to_jsonb(old) - array['lifecycle', 'updated_at']) then
        return new;
      end if;
    end if;
  else
    if tg_op = 'DELETE' then
      v_template := old.template_id;
    else
      v_template := new.template_id;
    end if;
  end if;

  select lifecycle
    into v_state
    from public.rubric_templates
   where id = v_template;

  if v_state is distinct from 'draft'::public.rubric_lifecycle then
    raise exception 'Published rubric versions are immutable; create a draft version'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

