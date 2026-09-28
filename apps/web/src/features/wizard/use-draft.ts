import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { WizardDraft, WizardFieldValue, WizardPatch } from '@bupa/contracts';
import { bookingWizard, type WizardFieldDefinition } from '@bupa/contracts/wizard';
import { api, ValidationError } from '@/lib/api';
import { keys, queryClient, invalidateAll } from '@/lib/query';
import { useWizard } from '@/stores/wizard';

export function useDraft(draftId: string) {
  const query = useQuery({ queryKey: keys.draft(draftId), queryFn: () => api.getDraft(draftId) });
  const setInvalid = useWizard((s) => s.setInvalid);

  const patch = useMutation({
    mutationFn: (input: WizardPatch) => api.patchDraft(draftId, input),
    onMutate: async (input) => {
      // Optimistic field updates keep typing responsive.
      if (!input.fields) return;
      await queryClient.cancelQueries({ queryKey: keys.draft(draftId) });
      queryClient.setQueryData<WizardDraft>(keys.draft(draftId), (current) => {
        if (!current) return current;
        const fields = { ...current.fields };
        for (const [key, value] of Object.entries(input.fields ?? {})) {
          fields[key] = { value: value ?? null, source: 'user', confirmed: true };
        }
        return { ...current, fields };
      });
    },
    onSuccess: (draft) => {
      queryClient.setQueryData(keys.draft(draftId), draft);
      setInvalid([]);
      void queryClient.invalidateQueries({ queryKey: keys.schedule });
    },
    onError: (error) => {
      if (error instanceof ValidationError) setInvalid(error.missing);
      void queryClient.invalidateQueries({ queryKey: keys.draft(draftId) });
    },
  });

  const submit = useMutation({
    mutationFn: () => api.submitDraft(draftId),
    onSuccess: () => invalidateAll(),
    onError: (error) => {
      if (error instanceof ValidationError) setInvalid(error.missing);
    },
  });

  const setField = (id: string, value: WizardFieldValue) =>
    patch.mutate({ fields: { [id]: value } });
  const goTo = (step: number) => patch.mutate({ step });

  return { query, draft: query.data, patch, submit, setField, goTo };
}

export function isVisible(draft: WizardDraft, def: WizardFieldDefinition) {
  if (!def.hiddenWhen) return true;
  const value = draft.fields[def.hiddenWhen.field]?.value;
  return !def.hiddenWhen.in.includes(String(value));
}

export function stepFields(draft: WizardDraft, step: number) {
  return bookingWizard.fields.filter((def) => def.step === step && isVisible(draft, def));
}

export function valueOf(draft: WizardDraft | undefined, id: string): WizardFieldValue {
  return draft?.fields[id]?.value ?? null;
}
export function stringOf(draft: WizardDraft | undefined, id: string) {
  const value = valueOf(draft, id);
  return typeof value === 'string' ? value : '';
}

/** True while a field should flash as "changed by AI"; the flash clears once it has been seen. */
export function useHighlight(fieldId: string) {
  const highlighted = useWizard((s) => s.highlighted.includes(fieldId));
  const unhighlight = useWizard((s) => s.unhighlight);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => unhighlight(fieldId), 2200);
    return () => clearTimeout(timer);
  }, [highlighted, fieldId, unhighlight]);
  return highlighted;
}
