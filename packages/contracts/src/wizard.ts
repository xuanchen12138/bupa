import type { FieldSource, LocalizedText, ProfileFieldName, ServiceType } from './index.js';

// Data-driven wizard definition. The web app renders any wizard from a definition like this;
// the api validates drafts against the same definition, so the rules live in one place.

export type WizardFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'boolean'
  | 'postcode'
  | 'provider'
  | 'slot'
  | 'readonly'
  | 'list';

export interface WizardFieldOption {
  value: string;
  label: LocalizedText;
  description?: LocalizedText;
}

export interface WizardFieldDefinition {
  id: string;
  step: 1 | 2 | 3 | 4 | 5;
  type: WizardFieldType;
  label: LocalizedText;
  hint?: LocalizedText;
  placeholder?: LocalizedText;
  required: boolean;
  /** Only required when this other field has the given value(s). */
  requiredWhen?: { field: string; in: string[] };
  /** Hidden when this other field has the given value(s). */
  hiddenWhen?: { field: string; in: string[] };
  options?: WizardFieldOption[];
  /** Profile field whose "allow AI to use" permission gates prefilling and use of this field. */
  consent?: ProfileFieldName;
  /** Profile field the value is copied from when permission allows. */
  profileField?: ProfileFieldName;
  /** Sources the AI or backend may prefill this field from. 'user' is always allowed. */
  sources: FieldSource[];
}

export interface WizardStepDefinition {
  step: 1 | 2 | 3 | 4 | 5;
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  /** Read-only steps have no editable fields; the user just confirms. */
  readonly?: boolean;
}

export interface WizardDefinition {
  type: 'booking';
  title: LocalizedText;
  steps: WizardStepDefinition[];
  fields: WizardFieldDefinition[];
}

export const serviceOptions: Array<WizardFieldOption & { value: ServiceType }> = [
  {
    value: 'gp',
    label: { en: 'GP (general practitioner)', zh: 'GP 全科医生' },
    description: {
      en: 'Cold, flu, sore throat, minor injuries, prescriptions.',
      zh: '感冒、发烧、喉咙痛、小外伤、开药。',
    },
  },
  {
    value: 'telehealth',
    label: { en: 'Telehealth (Blua)', zh: '远程问诊（Blua）' },
    description: {
      en: 'Video consult from home, no address needed.',
      zh: '在家视频问诊，不需要地址。',
    },
  },
  {
    value: 'mental_health',
    label: { en: 'Mental health support', zh: '心理支持' },
    description: { en: 'Counselling and psychology.', zh: '心理咨询与心理治疗。' },
  },
  {
    value: 'dental',
    label: { en: 'Dental', zh: '牙科' },
    description: { en: 'Check-ups and dental treatment.', zh: '检查与牙科治疗。' },
  },
];

export const bookingSteps: WizardStepDefinition[] = [
  {
    step: 1,
    id: 'service',
    title: { en: 'Service & need', zh: '服务与需求' },
    description: {
      en: 'What kind of care do you need? The AI never diagnoses—this only picks the right door.',
      zh: '你需要哪一类服务？AI 不做诊断，这一步只是选对入口。',
    },
  },
  {
    step: 2,
    id: 'cover',
    title: { en: 'Cover & cost', zh: '保障与费用' },
    description: {
      en: 'What your policy covers for this visit, with the clause it comes from.',
      zh: '这次就诊你的保单覆盖多少，附条款出处。',
    },
    readonly: true,
  },
  {
    step: 3,
    id: 'provider',
    title: { en: 'Clinic & time', zh: '诊所与时间' },
    description: {
      en: 'Three recommended options and why. Your postcode is only used to search nearby.',
      zh: '三个推荐选项与推荐理由。邮编只用于搜索附近诊所。',
    },
  },
  {
    step: 4,
    id: 'patient',
    title: { en: 'Your details', zh: '就诊人信息' },
    description: {
      en: 'Prefilled from your profile where you have allowed it.',
      zh: '在你允许的范围内，从 Profile 预填。',
    },
  },
  {
    step: 5,
    id: 'confirm',
    title: { en: 'Confirm & book', zh: '确认并提交' },
    description: {
      en: 'Nothing is booked until you press Confirm booking.',
      zh: '在你点击“确认预约”之前，不会创建任何预约。',
    },
  },
];

export const bookingFields: WizardFieldDefinition[] = [
  {
    id: 'serviceType',
    step: 1,
    type: 'select',
    label: { en: 'Type of service', zh: '服务类型' },
    required: true,
    options: serviceOptions,
    sources: ['conversation'],
  },
  {
    id: 'need',
    step: 1,
    type: 'textarea',
    label: { en: 'What do you need help with?', zh: '需求简述' },
    hint: {
      en: 'A short note for the clinic. Symptoms you mention here are not saved to your profile.',
      zh: '给诊所的一句话说明。这里提到的症状不会存入你的档案。',
    },
    placeholder: {
      en: 'e.g. sore throat and low fever for two days',
      zh: '例如：喉咙痛、低烧两天',
    },
    required: true,
    sources: ['conversation'],
  },
  {
    id: 'acceptTelehealth',
    step: 1,
    type: 'boolean',
    label: { en: 'Happy to see a doctor by video if it is sooner', zh: '如果更快，也接受视频问诊' },
    required: false,
    consent: 'consultPreference',
    profileField: 'consultPreference',
    sources: ['conversation', 'profile'],
  },
  {
    id: 'coverStatus',
    step: 2,
    type: 'readonly',
    label: { en: 'Cover status', zh: '保障状态' },
    required: false,
    sources: ['cover'],
  },
  {
    id: 'coverOutOfPocket',
    step: 2,
    type: 'readonly',
    label: { en: 'Estimated out-of-pocket', zh: '自付估算' },
    required: false,
    sources: ['cover'],
  },
  {
    id: 'coverSource',
    step: 2,
    type: 'readonly',
    label: { en: 'Policy clause', zh: '条款出处' },
    required: false,
    sources: ['cover'],
  },
  {
    id: 'coverDisclaimer',
    step: 2,
    type: 'readonly',
    label: { en: 'Please note', zh: '免责说明' },
    required: false,
    sources: ['cover'],
  },
  {
    id: 'postcode',
    step: 3,
    type: 'postcode',
    label: { en: 'Postcode to search near', zh: '搜索附近的邮编' },
    hint: {
      en: 'Only used to find nearby clinics. Leave empty to see telehealth options only.',
      zh: '只用于查找附近诊所。留空则只显示远程问诊选项。',
    },
    required: false,
    hiddenWhen: { field: 'serviceType', in: ['telehealth'] },
    consent: 'postcode',
    profileField: 'postcode',
    sources: ['profile', 'conversation'],
  },
  {
    id: 'providerId',
    step: 3,
    type: 'provider',
    label: { en: 'Recommended options', zh: '推荐选项' },
    required: true,
    sources: ['conversation'],
  },
  {
    id: 'slotId',
    step: 3,
    type: 'slot',
    label: { en: 'Pick a time', zh: '选择时段' },
    required: true,
    sources: ['conversation'],
  },
  {
    id: 'patientName',
    step: 4,
    type: 'text',
    label: { en: 'Name', zh: '姓名' },
    required: true,
    consent: 'name',
    profileField: 'name',
    sources: ['profile'],
  },
  {
    id: 'memberNumber',
    step: 4,
    type: 'text',
    label: { en: 'Member number', zh: '会员号' },
    required: true,
    consent: 'memberNumber',
    profileField: 'memberNumber',
    sources: ['profile'],
  },
  {
    id: 'phone',
    step: 4,
    type: 'text',
    label: { en: 'Mobile', zh: '电话' },
    required: true,
    consent: 'phone',
    profileField: 'phone',
    sources: ['profile'],
  },
  {
    id: 'language',
    step: 4,
    type: 'select',
    label: { en: 'Preferred language at the visit', zh: '就诊时的语言' },
    required: false,
    options: [
      { value: 'zh-CN', label: { en: 'Mandarin', zh: '中文（普通话）' } },
      { value: 'en', label: { en: 'English', zh: '英语' } },
      { value: 'other', label: { en: 'Other', zh: '其他' } },
    ],
    consent: 'preferredLanguage',
    profileField: 'preferredLanguage',
    sources: ['profile', 'conversation'],
  },
  {
    id: 'interpreter',
    step: 4,
    type: 'boolean',
    label: { en: 'I would like an interpreter', zh: '需要口译' },
    hint: {
      en: 'Free phone interpreting (TIS National) can be arranged by the clinic.',
      zh: '诊所可以安排免费电话口译（TIS National）。',
    },
    required: false,
    consent: 'interpreter',
    profileField: 'interpreter',
    sources: ['profile', 'conversation'],
  },
  {
    id: 'notes',
    step: 4,
    type: 'textarea',
    label: { en: 'Anything the clinic should know', zh: '给诊所的备注' },
    placeholder: { en: 'Optional', zh: '选填' },
    required: false,
    sources: ['conversation'],
  },
  {
    id: 'whatToBring',
    step: 5,
    type: 'list',
    label: { en: 'What to bring', zh: '要带的东西' },
    required: false,
    sources: ['cover', 'conversation'],
  },
  {
    id: 'reminder',
    step: 5,
    type: 'boolean',
    label: { en: 'Remind me before the visit', zh: '就诊前提醒我' },
    required: false,
    sources: ['conversation', 'profile'],
  },
  {
    id: 'reminderLead',
    step: 5,
    type: 'select',
    label: { en: 'Remind me', zh: '提醒时间' },
    required: false,
    hiddenWhen: { field: 'reminder', in: ['false'] },
    options: [
      { value: '24h', label: { en: 'The day before', zh: '前一天' } },
      { value: '2h', label: { en: '2 hours before', zh: '提前 2 小时' } },
    ],
    sources: ['conversation'],
  },
];

export const bookingWizard: WizardDefinition = {
  type: 'booking',
  title: { en: 'Book an appointment', zh: '预约医生' },
  steps: bookingSteps,
  fields: bookingFields,
};

export function fieldsForStep(definition: WizardDefinition, step: number) {
  return definition.fields.filter((field) => field.step === step);
}
