/** Human descriptions of delegated permissions (agent tokens and OAuth consent use the same words). */
export const SCOPE_DESCRIPTIONS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'catalog:read', label: 'Read the public catalog' },
  { id: 'requirements:read', label: "Read your organization's private requirements" },
  { id: 'requirements:write', label: 'Save private requirement drafts' },
  { id: 'engagements:write', label: 'Prepare demo/RFI requests (each still needs your approval)' },
  {
    id: 'supplier:write',
    label:
      'Upload content and draft claims in your supplier workspace (publishing still needs your approval)',
  },
];

export const describeScope = (id: string): string =>
  SCOPE_DESCRIPTIONS.find((scope) => scope.id === id)?.label ?? id;
