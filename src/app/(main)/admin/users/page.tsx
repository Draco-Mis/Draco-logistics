'use client'

import { PageLoading } from '@/components/ui/PageLoading'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { User, UserRole } from '@/types/database'
import { cn, getRoleLabel, getRoleColor } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

export default function UsersManagementPage() {
  const { user: currentUser, realUser, startImpersonation } = useAuth()
  const supabase = createClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  // 職稱：從員工名冊依中文姓名比對帶入（唯讀顯示，永遠與名冊同步）
  const [titleByName, setTitleByName] = useState<Map<string, string>>(new Map())

  // 新增使用者表單狀態
  const [showForm, setShowForm] = useState(false)
  const [formEmail, setFormEmail] = useState('')
  const [formName, setFormName] = useState('')
  const [formChineseName, setFormChineseName] = useState('')
  const [formRole, setFormRole] = useState<UserRole>('sales')
  const [formTeam, setFormTeam] = useState<'業務部' | '業一課' | '業二課' | '專案課' | '電商課' | '物流一部' | '物流二部' | '報關部' | '財管部' | '管理員'>('業一課')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 編輯使用者 Modal 狀態
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [editName, setEditName] = useState('')
  const [editChineseName, setEditChineseName] = useState('')
  const [editRole, setEditRole] = useState<UserRole>('sales')
  const [editTeam, setEditTeam] = useState<'業務部' | '業一課' | '業二課' | '專案課' | '電商課' | '物流一部' | '物流二部' | '報關部' | '財管部' | '管理員'>('業一課')
  const [editIsActive, setEditIsActive] = useState(true)
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    fetchUsers()
  }, [])

  function resetForm() {
    setFormEmail('')
    setFormName('')
    setFormChineseName('')
    setFormRole('sales')
    setFormTeam('業一課')
    setFormError('')
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)

    const resp = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: formEmail.trim(),
        name: formName.trim(),
        chinese_name: formChineseName.trim(),
        role: formRole,
        team: formTeam,
      }),
    })

    const result = await resp.json()
    setSubmitting(false)

    if (!resp.ok) {
      setFormError(result.error || '建立失敗')
      return
    }

    await confirm({
      title: '使用者建立成功',
      message: `登入資訊：\n帳號：${formEmail}\n密碼：Draco2026\n\n請告知 ${formChineseName} 用此密碼登入，首次登入會強制改密碼。`,
      confirmLabel: '知道了',
      cancelLabel: '關閉',
    })
    setShowForm(false)
    resetForm()
    fetchUsers()
  }

  async function fetchUsers() {
    const { data } = await supabase
      .from('users')
      .select('*')
      .order('team')
      .order('name')

    if (data) setUsers(data)

    // 一併撈員工名冊職稱，依中文姓名建立對應表
    const { data: emps } = await supabase
      .from('employees')
      .select('chinese_name, title')
    if (emps) {
      const map = new Map<string, string>()
      for (const e of emps as { chinese_name: string | null; title: string | null }[]) {
        const name = e.chinese_name?.trim()
        if (name && e.title?.trim()) map.set(name, e.title.trim())
      }
      setTitleByName(map)
    }

    setLoading(false)
  }

  async function handleDeactivate(targetUser: User) {
    if (!currentUser || currentUser.role !== 'admin') return

    // 保護 1：admin 不能把自己設為離職
    if (targetUser.id === currentUser.id) {
      toast.error('您不能把自己設為離職狀態')
      return
    }

    // 保護 2：不能停用最後一位在職的 admin
    if (targetUser.role === 'admin' && targetUser.is_active) {
      const activeAdminCount = users.filter(u => u.role === 'admin' && u.is_active).length
      if (activeAdminCount <= 1) {
        toast.error('系統必須保留至少一位管理員，無法停用最後一位管理員')
        return
      }
    }

    const ok = await confirm({
      title: '設為離職',
      message: `確定要將 ${targetUser.chinese_name} 設為離職嗎？其名下所有客戶將被鎖檔。`,
      danger: true,
      confirmLabel: '設為離職',
    })
    if (!ok) return

    // Deactivate user
    await supabase
      .from('users')
      .update({ is_active: false })
      .eq('id', targetUser.id)

    // Lock all their customers
    const { data: customers } = await supabase
      .from('customers')
      .select('id')
      .eq('assigned_to', targetUser.id)
      .neq('status', 'locked')

    if (customers && customers.length > 0) {
      await supabase
        .from('customers')
        .update({
          status: 'locked',
          locked_at: new Date().toISOString(),
          locked_reason: `業務 ${targetUser.chinese_name} 離職`,
        })
        .eq('assigned_to', targetUser.id)
        .neq('status', 'locked')

      // Add history for each
      await supabase.from('customer_history').insert(
        customers.map((c) => ({
          customer_id: c.id,
          action_type: 'locked' as const,
          action_by: currentUser.id,
          note: `業務 ${targetUser.chinese_name} 離職，客戶自動鎖檔`,
        }))
      )

      // Notify admin
      await supabase.from('notifications').insert({
        user_id: currentUser.id,
        title: '業務離職處理完成',
        message: `${targetUser.chinese_name} 名下 ${customers.length} 筆客戶已全部鎖檔，等待重新指派`,
        link: '/customers?status=locked',
      })
    }

    fetchUsers()
  }

  async function handleReactivate(targetUser: User) {
    if (!currentUser || currentUser.role !== 'admin') return
    await supabase
      .from('users')
      .update({ is_active: true })
      .eq('id', targetUser.id)
    fetchUsers()
  }

  function openEdit(u: User) {
    setEditTarget(u)
    setEditName(u.name)
    setEditChineseName(u.chinese_name)
    setEditRole(u.role)
    setEditTeam(u.team)
    setEditIsActive(u.is_active)
    setEditError('')
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setEditError('')
    setEditSaving(true)

    const resp = await fetch('/api/admin/users/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editTarget.id,
        name: editName.trim(),
        chinese_name: editChineseName.trim(),
        role: editRole,
        team: editTeam,
        is_active: editIsActive,
      }),
    })
    const result = await resp.json()
    setEditSaving(false)

    if (!resp.ok) {
      setEditError(result.error || '儲存失敗')
      return
    }

    setEditTarget(null)
    fetchUsers()
  }

  async function handleResetPassword(targetUser: User) {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'chairman')) return
    if (targetUser.id === currentUser.id) {
      toast.error('不能重設自己的密碼，請到「更多 → 修改密碼」自行修改')
      return
    }
    const ok = await confirm({
      title: '重設密碼',
      message: `確定要把 ${targetUser.chinese_name}（${targetUser.email}）的密碼重設為 Draco2026？\n\n對方下次登入時會被強制改密碼。`,
      danger: true,
      confirmLabel: '重設密碼',
    })
    if (!ok) return

    const resp = await fetch('/api/admin/users/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: targetUser.id }),
    })
    const result = await resp.json()
    if (!resp.ok) {
      toast.error(result.error || '重設失敗')
      return
    }
    await confirm({
      title: '密碼已重設',
      message: `${targetUser.chinese_name} 的密碼已重設為 Draco2026，下次登入會強制改密碼。`,
      confirmLabel: '知道了',
      cancelLabel: '關閉',
    })
    fetchUsers()
  }

  if (currentUser?.role !== 'admin' && currentUser?.role !== 'chairman') {
    return <div className="p-4 text-center py-12 text-gray-400">您沒有權限查看此頁面</div>
  }

  if (loading) {
    return (
      <PageLoading />
    )
  }

  const teams = ['業務部', '業一課', '業二課', '專案課', '電商課', '物流一部', '物流二部', '報關部', '財管部', '管理員']

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">使用者管理</h1>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="btn-primary text-sm"
        >
          ➕ 新增使用者
        </button>
      </div>

      {/* 新增使用者 Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">新增使用者</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleCreateUser} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  電子郵件 <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="input-field"
                  placeholder="name@dracolog.com"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    英文名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="input-field"
                    placeholder="Reina"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    中文名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formChineseName}
                    onChange={(e) => setFormChineseName(e.target.value)}
                    className="input-field"
                    placeholder="莊采妮"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  角色 <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { val: 'sales', label: '業務' },
                    { val: 'deputy_manager', label: '副課長' },
                    { val: 'finance', label: '財務' },
                    { val: 'hr', label: '人資' },
                    { val: 'manager', label: '課長' },
                    { val: 'director', label: '部長' },
                    { val: 'admin', label: '管理員' },
                    { val: 'chairman', label: '董事長' },
                  ] as const).map((r) => (
                    <button
                      type="button"
                      key={r.val}
                      onClick={() => setFormRole(r.val)}
                      className={cn(
                        'py-2 rounded-lg text-sm font-medium border-2 transition',
                        formRole === r.val
                          ? 'border-primary-600 bg-primary-600 text-white'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-gray-500 leading-relaxed">
                  <p><span className="font-semibold text-gray-600">管理員：</span>最高權限（可管理帳號、審核轉移）</p>
                  <p><span className="font-semibold text-gray-600">董事長：</span>看全部、可管理使用者，無報表權限</p>
                  <p><span className="font-semibold text-gray-600">部長：</span>同課長權限，可看本課組員報表及績效</p>
                  <p><span className="font-semibold text-gray-600">課長：</span>可審核客戶轉移申請、看本課報表</p>
                  <p><span className="font-semibold text-gray-600">人資：</span>人資部門人員（一般權限）</p>
                  <p><span className="font-semibold text-gray-600">財務：</span>財務部門人員（一般權限）</p>
                  <p><span className="font-semibold text-gray-600">業務：</span>一般業務或各課人員</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  課別 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formTeam}
                  onChange={(e) => setFormTeam(e.target.value as typeof formTeam)}
                  className="input-field"
                >
                  <option value="業務部">業務部</option>
                  <option value="業一課">業一課</option>
                  <option value="業二課">業二課</option>
                  <option value="專案課">專案課</option>
                  <option value="電商課">電商課</option>
                  <option value="物流一部">物流一部</option>
                  <option value="物流二部">物流二部</option>
                  <option value="報關部">報關部</option>
                  <option value="財管部">財管部</option>
                  <option value="管理員">管理員</option>
                </select>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                🔑 建立後，對方可直接用臨時密碼 <strong>Draco2026</strong> 登入，首次登入會強制修改密碼。
              </div>

              {formError && (
                <p className="text-red-500 text-sm text-center">{formError}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary flex-1"
                >
                  {submitting ? '建立中...' : '建立使用者'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="btn-secondary"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 編輯使用者 Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">編輯 {editTarget.chinese_name}</h2>
              <button onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-5 space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">電子郵件（不可修改）</p>
                <p className="text-sm font-medium text-gray-900">{editTarget.email}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">英文名</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">中文名</label>
                  <input
                    type="text"
                    value={editChineseName}
                    onChange={(e) => setEditChineseName(e.target.value)}
                    className="input-field"
                    required
                  />
                </div>
              </div>

              {(() => {
                const isSelf = editTarget.id === currentUser?.id
                const activeAdminCount = users.filter(u => u.role === 'admin' && u.is_active).length
                const isLastAdmin = editTarget.role === 'admin' && editTarget.is_active && activeAdminCount <= 1
                const roleLocked = isSelf || isLastAdmin
                const roleLockReason = isSelf
                  ? '您不能修改自己的角色，請請其他管理員代為操作'
                  : isLastAdmin
                    ? '這是系統最後一位管理員，無法降級'
                    : ''
                return (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      角色
                      {roleLocked && (
                        <span className="ml-1 text-xs text-amber-600">（已鎖定）</span>
                      )}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { val: 'sales', label: '業務' },
                        { val: 'deputy_manager', label: '副課長' },
                        { val: 'finance', label: '財務' },
                        { val: 'hr', label: '人資' },
                        { val: 'manager', label: '課長' },
                        { val: 'director', label: '部長' },
                        { val: 'admin', label: '管理員' },
                        { val: 'chairman', label: '董事長' },
                      ] as const).map((r) => (
                        <button
                          type="button"
                          key={r.val}
                          onClick={() => !roleLocked && setEditRole(r.val)}
                          disabled={roleLocked}
                          className={cn(
                            'py-2 rounded-lg text-sm font-medium border-2 transition',
                            editRole === r.val
                              ? 'border-primary-600 bg-primary-600 text-white'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
                            roleLocked && 'opacity-60 cursor-not-allowed hover:border-gray-200'
                          )}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                    {roleLocked && (
                      <p className="text-xs text-amber-700 mt-2">⚠️ {roleLockReason}</p>
                    )}
                    <div className="mt-2 space-y-0.5 text-xs text-gray-500 leading-relaxed">
                      <p><span className="font-semibold text-gray-600">管理員：</span>最高權限（可管理帳號、審核轉移）</p>
                      <p><span className="font-semibold text-gray-600">董事長：</span>看全部、可管理使用者，無報表權限</p>
                      <p><span className="font-semibold text-gray-600">部長：</span>同課長權限，可看本課組員報表及績效</p>
                      <p><span className="font-semibold text-gray-600">課長：</span>可審核客戶轉移申請、看本課報表</p>
                      <p><span className="font-semibold text-gray-600">業務：</span>一般業務或各課人員</p>
                    </div>
                  </div>
                )
              })()}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">課別</label>
                <select
                  value={editTeam}
                  onChange={(e) => setEditTeam(e.target.value as typeof editTeam)}
                  className="input-field"
                >
                  <option value="業務部">業務部</option>
                  <option value="業一課">業一課</option>
                  <option value="業二課">業二課</option>
                  <option value="專案課">專案課</option>
                  <option value="電商課">電商課</option>
                  <option value="物流一部">物流一部</option>
                  <option value="物流二部">物流二部</option>
                  <option value="報關部">報關部</option>
                  <option value="財管部">財管部</option>
                  <option value="管理員">管理員</option>
                </select>
              </div>

              {(() => {
                const isSelf = editTarget.id === currentUser?.id
                const activeAdminCount = users.filter(u => u.role === 'admin' && u.is_active).length
                const isLastAdmin = editTarget.role === 'admin' && editTarget.is_active && activeAdminCount <= 1
                const activeLocked = isSelf || isLastAdmin
                const activeLockReason = isSelf
                  ? '不能把自己設為離職'
                  : isLastAdmin
                    ? '這是系統最後一位管理員，無法停用'
                    : ''
                return (
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editIsActive}
                        onChange={(e) => setEditIsActive(e.target.checked)}
                        className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                        disabled={activeLocked}
                      />
                      <span>在職中</span>
                      {activeLocked && (
                        <span className="text-xs text-gray-400">（{activeLockReason}）</span>
                      )}
                    </label>
                    {!editIsActive && editTarget.is_active && (
                      <p className="text-xs text-amber-700 mt-1">
                        ⚠️ 取消勾選只會改變狀態旗標。若要同時鎖所有客戶請使用「離職」按鈕。
                      </p>
                    )}
                  </div>
                )
              })()}

              {editError && (
                <p className="text-red-500 text-sm text-center">{editError}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={editSaving}
                  className="btn-primary flex-1"
                >
                  {editSaving ? '儲存中...' : '儲存變更'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="btn-secondary"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {teams.map((team) => {
        const teamUsers = users.filter((u) => u.team === team)
        return (
          <div key={team} className="mb-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">{team}</h2>
            <div className="space-y-2">
              {teamUsers.map((u) => (
                <div key={u.id} className={cn('card flex items-center justify-between', !u.is_active && 'opacity-50')}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{u.chinese_name}（{u.name}）</span>
                      <span className={cn('badge', getRoleColor(u.role))}>
                        {getRoleLabel(u.role)}
                      </span>
                      {titleByName.get(u.chinese_name) && (
                        <span
                          className="badge bg-gray-100 text-gray-600"
                          title="職稱來自員工名冊（依姓名比對）"
                        >
                          {titleByName.get(u.chinese_name)}
                        </span>
                      )}
                      {!u.is_active && <span className="badge bg-red-100 text-red-600">已離職</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {u.email}
                      {!titleByName.get(u.chinese_name) && (
                        <span className="ml-2 text-gray-300">· 名冊無對應職稱</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {realUser?.role === 'admin' && u.id !== realUser.id && (
                      <button
                        onClick={() => startImpersonation(u)}
                        className="text-sm text-orange-600 hover:text-orange-800"
                        title="以此使用者的視角檢視系統（UI 偽裝，不影響資料庫操作）"
                      >
                        👁 視角
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(u)}
                      className="text-sm text-gray-600 hover:text-gray-900"
                      title="編輯角色 / 課別 / 姓名"
                    >
                      ✏️ 編輯
                    </button>
                    {u.is_active && u.id !== currentUser?.id && (
                      <button
                        onClick={() => handleResetPassword(u)}
                        className="text-sm text-primary-600 hover:text-primary-800"
                        title="重設密碼為 Draco2026"
                      >
                        🔑 重設密碼
                      </button>
                    )}
                    {u.id !== currentUser?.id && (
                      u.is_active ? (
                        <button
                          onClick={() => handleDeactivate(u)}
                          className="text-sm text-red-500 hover:text-red-700"
                          title="設為離職（會鎖所有客戶）"
                        >
                          離職
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(u)}
                          className="text-sm text-green-500 hover:text-green-700"
                        >
                          復職
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
