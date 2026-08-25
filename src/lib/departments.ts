// 人才適性評估表單的部門選項
// 同時用在受測者作答表單與 HR 後台「修正資料」表單，確保兩邊選項一致
export const ASSESSMENT_DEPARTMENTS = [
  '副總',
  '業務部',
  '物流部',
  '報關部',
  '財管部',
  '電商課',
  '其他',
] as const

export type AssessmentDepartment = typeof ASSESSMENT_DEPARTMENTS[number]
