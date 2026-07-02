import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import { onValue, ref, remove, set } from 'firebase/database'
import { Navigate, Route, Routes } from 'react-router-dom'
import { auth, database } from './firebase'

type TransactionType = 'income' | 'expense'
type Feature = 'dashboard' | 'add' | 'transactions' | 'insights' | 'backup'

type Transaction = {
  id: string
  title: string
  amount: number
  category: string
  date: string
  type: TransactionType
  note: string
}

type FormState = Omit<Transaction, 'id' | 'amount'> & {
  amount: string
}

const categories = [
  'Food',
  'Transport',
  'Bills',
  'Shopping',
  'Health',
  'Entertainment',
  'Salary',
  'Freelance',
  'Other',
]

const features: Array<{ id: Feature; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'add', label: 'Add Entry' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'insights', label: 'Insights' },
  { id: 'backup', label: 'Backup' },
]

const initialForm: FormState = {
  title: '',
  amount: '',
  category: 'Food',
  date: new Date().toISOString().slice(0, 10),
  type: 'expense',
  note: '',
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'BDT',
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const appShellClasses =
  'min-h-svh bg-[#f8fafc] px-4 py-4 text-slate-600 antialiased sm:px-7 sm:py-7'
const cardClasses =
  'rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]'
const sectionLabelClasses =
  'mb-2 text-xs font-extrabold uppercase tracking-wider text-emerald-700'
const headingClasses = 'm-0 text-xl font-bold text-slate-950'
const cardTitleClasses = 'm-0 text-base font-extrabold text-slate-950'
const buttonBaseClasses =
  'min-h-11 cursor-pointer rounded-xl px-4 font-extrabold transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-70 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-emerald-700/25'
const fieldClasses =
  'min-h-11 min-w-0 w-full max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-950 outline-none shadow-inner shadow-slate-100/70 focus:border-emerald-600 focus:outline-3 focus:outline-offset-2 focus:outline-emerald-700/20'
const labelClasses = 'grid min-w-0 gap-2 text-sm font-extrabold text-slate-950'
const mutedTextClasses = 'text-slate-500'

function createId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function getTransactionsPath(userId: string) {
  return `users/${userId}/transactions`
}

function getBarWidthClasses(percent: number) {
  if (percent >= 90) return 'w-full'
  if (percent >= 75) return 'w-5/6'
  if (percent >= 60) return 'w-2/3'
  if (percent >= 45) return 'w-1/2'
  if (percent >= 30) return 'w-1/3'
  if (percent >= 15) return 'w-1/4'
  return 'w-1/6'
}

function isTransaction(item: unknown): item is Transaction {
  if (!item || typeof item !== 'object') {
    return false
  }

  const transaction = item as Record<string, unknown>

  return (
    typeof transaction.id === 'string' &&
    typeof transaction.title === 'string' &&
    typeof transaction.amount === 'number' &&
    typeof transaction.category === 'string' &&
    typeof transaction.date === 'string' &&
    (transaction.type === 'income' || transaction.type === 'expense') &&
    typeof transaction.note === 'string'
  )
}

function parseTransactions(value: unknown): Transaction[] {
  if (Array.isArray(value)) {
    return value.filter(isTransaction)
  }

  if (value && typeof value === 'object') {
    return Object.values(value).filter(isTransaction)
  }

  return []
}

function getAuthErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (message.includes('auth/configuration-not-found')) {
    return 'Firebase Auth is not enabled for this project. In Firebase Console, enable Authentication and turn on the Email/Password sign-in provider.'
  }

  if (message.includes('auth/invalid-credential')) {
    return 'The email or password is incorrect.'
  }

  if (message.includes('auth/email-already-in-use')) {
    return 'This email already has an account. Try logging in instead.'
  }

  if (message.includes('auth/weak-password')) {
    return 'Use a password with at least 6 characters.'
  }

  return message || 'Could not authenticate.'
}

function ProtectedRoute({ children, user }: { children: ReactNode; user: User | null }) {
  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [filter, setFilter] = useState<'all' | TransactionType>('all')
  const [query, setQuery] = useState('')
  const [activeFeature, setActiveFeature] = useState<Feature>('dashboard')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [syncError, setSyncError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!user) {
      return
    }

    const unsubscribe = onValue(
      ref(database, getTransactionsPath(user.uid)),
      (snapshot) => {
        setTransactions(parseTransactions(snapshot.val()))
        setIsLoading(false)
        setSyncError('')
      },
      (error) => {
        setIsLoading(false)
        setSyncError(error.message)
      },
    )

    return unsubscribe
  }, [user])

  const sortedTransactions = useMemo(() => {
    return [...transactions].sort((a, b) => b.date.localeCompare(a.date))
  }, [transactions])

  const filteredTransactions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return sortedTransactions.filter((transaction) => {
      const matchesType = filter === 'all' || transaction.type === filter
      const matchesQuery =
        !normalizedQuery ||
        transaction.title.toLowerCase().includes(normalizedQuery) ||
        transaction.category.toLowerCase().includes(normalizedQuery) ||
        transaction.note.toLowerCase().includes(normalizedQuery)

      return matchesType && matchesQuery
    })
  }, [filter, query, sortedTransactions])

  const totals = useMemo(() => {
    const income = transactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((total, transaction) => total + transaction.amount, 0)
    const expense = transactions
      .filter((transaction) => transaction.type === 'expense')
      .reduce((total, transaction) => total + transaction.amount, 0)

    return {
      balance: income - expense,
      expense,
      income,
    }
  }, [transactions])

  const categoryTotals = useMemo(() => {
    const totalsByCategory = transactions.reduce<Record<string, number>>(
      (total, transaction) => {
        if (transaction.type === 'expense') {
          total[transaction.category] = (total[transaction.category] ?? 0) + transaction.amount
        }

        return total
      },
      {},
    )

    return Object.entries(totalsByCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [transactions])

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError('')
    setAuthSubmitting(true)

    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, authEmail, authPassword)
      } else {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword)
      }
    } catch (error) {
      setAuthError(getAuthErrorMessage(error))
    } finally {
      setAuthSubmitting(false)
    }
  }

  const handleFieldChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = event.target

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }))
  }

  const handleTypeChange = (type: TransactionType) => {
    setForm((currentForm) => ({
      ...currentForm,
      type,
      category: type === 'income' ? 'Salary' : 'Food',
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!user) {
      return
    }

    const amount = Number(form.amount)
    const title = form.title.trim()

    if (!title || !Number.isFinite(amount) || amount <= 0) {
      return
    }

    const transaction = {
      id: createId(),
      title,
      amount,
      category: form.category,
      date: form.date,
      type: form.type,
      note: form.note.trim(),
    }

    try {
      await set(ref(database, `${getTransactionsPath(user.uid)}/${transaction.id}`), transaction)
      setForm({
        ...initialForm,
        date: new Date().toISOString().slice(0, 10),
        type: form.type,
        category: form.type === 'income' ? 'Salary' : 'Food',
      })
      setActiveFeature('transactions')
      setSyncError('')
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not save transaction')
    }
  }

  const handleDelete = async (id: string) => {
    if (!user) {
      return
    }

    try {
      await remove(ref(database, `${getTransactionsPath(user.uid)}/${id}`))
      setSyncError('')
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not delete transaction')
    }
  }

  const handleExport = () => {
    const file = new Blob([JSON.stringify(transactions, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')

    link.href = url
    link.download = `expense-tracker-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file || !user) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)

      if (!Array.isArray(parsed)) {
        throw new Error('Invalid file')
      }

      const importedTransactions = parsed.map((item): Transaction => {
        const amount = Number(item.amount)

        if (
          typeof item.title !== 'string' ||
          !Number.isFinite(amount) ||
          typeof item.category !== 'string' ||
          typeof item.date !== 'string' ||
          (item.type !== 'income' && item.type !== 'expense')
        ) {
          throw new Error('Invalid file')
        }

        return {
          id: typeof item.id === 'string' ? item.id : createId(),
          title: item.title,
          amount,
          category: item.category,
          date: item.date,
          type: item.type,
          note: typeof item.note === 'string' ? item.note : '',
        }
      })

      const transactionMap = importedTransactions.reduce<Record<string, Transaction>>(
        (total, transaction) => {
          total[transaction.id] = transaction
          return total
        },
        {},
      )

      await set(ref(database, getTransactionsPath(user.uid)), transactionMap)
      setSyncError('')
    } catch {
      alert('This JSON file does not look like an expense tracker backup.')
    } finally {
      event.target.value = ''
    }
  }

  const handleSignOut = async () => {
    setTransactions([])
    setSyncError('')
    await signOut(auth)
  }

  const renderSummary = () => (
    <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]" aria-label="Account summary">
      <article className="grid min-h-32 content-center gap-2 rounded-2xl bg-linear-to-br from-slate-800 via-slate-700 to-emerald-700 p-6 text-white shadow-[0_18px_48px_rgba(51,65,85,0.14)]">
        <span>Total balance</span>
        <strong className="text-3xl leading-none sm:text-4xl">
          {currencyFormatter.format(totals.balance)}
        </strong>
      </article>
      <article className={`${cardClasses} grid min-h-32 content-center gap-2 p-6`}>
        <span className={mutedTextClasses}>Income</span>
        <strong className="text-3xl leading-none text-slate-950 sm:text-4xl">
          {currencyFormatter.format(totals.income)}
        </strong>
      </article>
      <article className={`${cardClasses} grid min-h-32 content-center gap-2 p-6`}>
        <span className={mutedTextClasses}>Expenses</span>
        <strong className="text-3xl leading-none text-slate-950 sm:text-4xl">
          {currencyFormatter.format(totals.expense)}
        </strong>
      </article>
    </section>
  )

  const renderForm = () => (
    <form className={`${cardClasses} mx-auto grid w-full max-w-3xl gap-4 p-3 sm:gap-5 sm:p-6`} onSubmit={handleSubmit}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={sectionLabelClasses}>New transaction</p>
          <h2 className={headingClasses}>Add entry</h2>
        </div>
      </div>

      <div
        className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1"
        aria-label="Transaction type"
      >
        {(['expense', 'income'] as const).map((type) => (
          <button
            key={type}
            type="button"
            className={`${buttonBaseClasses} min-h-9 flex-1 px-3 capitalize ${
              form.type === type
                ? 'bg-white text-slate-950 shadow-[0_8px_20px_rgba(51,65,85,0.08)]'
                : 'bg-transparent text-slate-600'
            }`}
            onClick={() => handleTypeChange(type)}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
        <label className={labelClasses}>
          Title
          <input
            className={fieldClasses}
            name="title"
            value={form.title}
            onChange={handleFieldChange}
            placeholder="Lunch, rent, salary"
            required
          />
        </label>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className={labelClasses}>
            Amount
            <input
              className={fieldClasses}
              name="amount"
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={handleFieldChange}
              placeholder="0.00"
              required
            />
          </label>
          <label className={labelClasses}>
            Date
            <input
              className={`${fieldClasses} block`}
              name="date"
              type="date"
              value={form.date}
              onChange={handleFieldChange}
            />
          </label>
        </div>

        <label className={labelClasses}>
          Category
          <select
            className={fieldClasses}
            name="category"
            value={form.category}
            onChange={handleFieldChange}
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClasses}>
          Note
          <textarea
            className={`${fieldClasses} resize-y`}
            name="note"
            value={form.note}
            onChange={handleFieldChange}
            placeholder="Optional detail"
            rows={3}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-full truncate rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-700 shadow-sm">
          {dateFormatter.format(new Date(`${form.date}T00:00:00`))}
        </div>
        <button
          type="submit"
          className={`${buttonBaseClasses} bg-emerald-700 px-8 text-white shadow-[0_14px_28px_rgba(16,124,99,0.20)]`}
        >
          Save
        </button>
      </div>
    </form>
  )

  const handleFeatureChange = (feature: Feature) => {
    setActiveFeature(feature)
    setIsMenuOpen(false)
  }

  const profileInitial = (user?.displayName || user?.email || 'U').charAt(0).toUpperCase()

  const renderTransactions = (options?: { limit?: number; compact?: boolean }) => {
    const visibleTransactions = options?.limit
      ? sortedTransactions.slice(0, options.limit)
      : filteredTransactions
    const shownCount = options?.limit
      ? Math.min(sortedTransactions.length, options.limit)
      : filteredTransactions.length

    return (
    <section className={`${cardClasses} p-4 lg:p-5`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className={sectionLabelClasses}>History</p>
          <h2 className={headingClasses}>
            {options?.compact ? 'Recent transactions' : 'Transactions'}
          </h2>
        </div>
        <div className="shrink-0 rounded-full bg-slate-100 px-3 py-2 text-sm font-extrabold text-slate-950">
          {shownCount} shown
        </div>
      </div>

      {!options?.compact && (
        <div className="mb-4 grid gap-3 md:flex md:items-center">
          <div
            className="flex min-w-full gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 md:min-w-80"
            aria-label="Filter by type"
          >
            {(['all', 'expense', 'income'] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={`${buttonBaseClasses} min-h-9 flex-1 px-3 capitalize ${
                  filter === type
                    ? 'bg-white text-slate-950 shadow-[0_8px_20px_rgba(51,65,85,0.08)]'
                    : 'bg-transparent text-slate-600'
                }`}
                onClick={() => setFilter(type)}
              >
                {type}
              </button>
            ))}
          </div>
          <input
            className={`${fieldClasses} md:max-w-64`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search transactions"
          />
        </div>
      )}

      <div className="grid gap-3">
        {visibleTransactions.length > 0 ? (
          visibleTransactions.map((transaction) => (
            <article
              key={transaction.id}
              className="grid items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[12px_minmax(0,1fr)_auto]"
            >
              <div
                className={`h-10 w-2 rounded-full sm:h-12 sm:w-2.5 ${
                  transaction.type === 'income'
                    ? 'bg-emerald-600'
                    : 'bg-blue-600'
                }`}
                aria-hidden="true"
              />
              <div className="grid min-w-0 gap-3 sm:flex sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="m-0 truncate text-base font-bold text-slate-950">
                    {transaction.title}
                  </h3>
                  <p className={`mt-1 text-sm ${mutedTextClasses}`}>
                    {transaction.category} ·{' '}
                    {dateFormatter.format(new Date(`${transaction.date}T00:00:00`))}
                  </p>
                  {transaction.note && (
                    <span className={`mt-1 block text-sm ${mutedTextClasses}`}>
                      {transaction.note}
                    </span>
                  )}
                </div>
                <strong
                  className={`shrink-0 text-base ${
                    transaction.type === 'income'
                      ? 'text-emerald-600'
                      : 'text-blue-700'
                  }`}
                >
                  {transaction.type === 'expense' ? '-' : '+'}
                  {currencyFormatter.format(transaction.amount)}
                </strong>
              </div>
              <button
                type="button"
                className={`${buttonBaseClasses} min-h-10 bg-slate-100 text-slate-700 sm:px-3`}
                onClick={() => handleDelete(transaction.id)}
                aria-label={`Delete ${transaction.title}`}
              >
                Delete
              </button>
            </article>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center">
            <h3 className="m-0 mb-2 text-lg font-bold text-slate-950">
              No transactions yet
            </h3>
            <p className={mutedTextClasses}>
              Add your first income or expense to start seeing your balance.
            </p>
          </div>
        )}
      </div>
    </section>
  )
  }

  const renderInsights = () => (
    <section className={`${cardClasses} grid gap-5 p-4 lg:p-5`}>
      <div>
        <p className={sectionLabelClasses}>Expense insight</p>
        <h2 className={cardTitleClasses}>Top categories</h2>
      </div>
      <div className="grid gap-3">
        {categoryTotals.length > 0 ? (
          categoryTotals.map(([category, amount]) => {
            const percent = totals.expense ? Math.round((amount / totals.expense) * 100) : 0

            return (
              <div
                key={category}
                className="grid items-center gap-2 font-extrabold text-slate-950 sm:grid-cols-[minmax(110px,0.3fr)_minmax(0,1fr)] sm:gap-4"
              >
                <span>{category}</span>
                <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full bg-emerald-700 ${getBarWidthClasses(percent)}`}
                    />
                  </div>
                  <strong>{currencyFormatter.format(amount)}</strong>
                </div>
              </div>
            )
          })
        ) : (
          <p className={mutedTextClasses}>
            Expense categories will appear after you add spending.
          </p>
        )}
      </div>
    </section>
  )

  const renderBackup = () => (
    <section className={`${cardClasses} grid gap-5 p-4 lg:p-5`}>
      <div>
        <p className={sectionLabelClasses}>Portable backup</p>
        <h2 className={cardTitleClasses}>JSON import/export</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={`${buttonBaseClasses} border border-slate-200 bg-white text-slate-950`}
          onClick={handleExport}
        >
          Export JSON
        </button>
        <button
          type="button"
          className={`${buttonBaseClasses} bg-emerald-700 text-white`}
          onClick={() => fileInputRef.current?.click()}
        >
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          onChange={handleImport}
        />
      </div>
    </section>
  )

  const renderFeature = () => {
    if (activeFeature === 'dashboard') {
      return (
        <div className="grid gap-3">
          {renderSummary()}
          <div className="grid gap-3 xl:grid-cols-[0.85fr_1.15fr]">
            {renderInsights()}
            {renderTransactions({ limit: 10, compact: true })}
          </div>
        </div>
      )
    }

    if (activeFeature === 'add') return renderForm()
    if (activeFeature === 'transactions') return renderTransactions()
    if (activeFeature === 'insights') return renderInsights()
    return renderBackup()
  }

  const renderTitleBar = () => (
    <header className="flex min-h-19 items-center justify-between gap-3 rounded-3xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_14px_44px_rgba(15,23,42,0.07)] lg:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
          aria-label="Open menu"
          onClick={() => setIsMenuOpen(true)}
        >
          <span className="grid gap-1">
            <span className="block h-0.5 w-5 rounded-full bg-slate-700" />
            <span className="block h-0.5 w-5 rounded-full bg-slate-700" />
            <span className="block h-0.5 w-5 rounded-full bg-slate-700" />
          </span>
        </button>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-extrabold uppercase tracking-wider text-slate-400">
            Page
          </p>
          <h2 className="m-0 truncate text-xl font-extrabold text-slate-950 sm:text-2xl">
            {features.find((feature) => feature.id === activeFeature)?.label}
          </h2>
        </div>
      </div>
      {activeFeature === 'dashboard' && (
        <button
          type="button"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-700 text-xl font-extrabold leading-none text-white shadow-[0_12px_24px_rgba(16,124,99,0.18)] transition hover:-translate-y-0.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-emerald-700/25"
          aria-label="Go to add entry"
          onClick={() => handleFeatureChange('add')}
        >
          +
        </button>
      )}
    </header>
  )

  const renderMenu = () => (
    <div className="flex min-h-full flex-col gap-5">
      <div>
        <p className="mb-2 text-xs font-extrabold uppercase tracking-wider text-emerald-700">
          Expense portal
        </p>
        <h1 className="m-0 text-2xl font-extrabold text-slate-950">Budget Desk</h1>
      </div>

      <nav className="grid gap-2" aria-label="Feature menu">
        {features.map((feature) => (
          <button
            key={feature.id}
            type="button"
            className={`rounded-2xl px-4 py-3 text-left transition hover:-translate-y-0.5 ${
              activeFeature === feature.id
                ? 'bg-emerald-700 text-white shadow-[0_12px_24px_rgba(16,124,99,0.18)]'
                : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
            onClick={() => handleFeatureChange(feature.id)}
          >
            <span className="block font-extrabold">{feature.label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-3">
          {user?.photoURL ? (
            <img className="h-12 w-12 rounded-2xl object-cover" src={user.photoURL} alt="" />
          ) : (
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-lg font-extrabold text-white">
              {profileInitial}
            </div>
          )}
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-extrabold text-slate-950">
              {user?.displayName || 'Profile'}
            </p>
            <p className={`truncate text-xs ${mutedTextClasses}`}>{user?.email}</p>
          </div>
        </div>
        <button
          type="button"
          className={`${buttonBaseClasses} min-h-10 border border-slate-200 bg-white text-slate-950 shadow-sm`}
          onClick={handleSignOut}
        >
          Sign out
        </button>
      </div>
    </div>
  )

  if (authLoading) {
    return (
      <main className={appShellClasses}>
          <div className="grid min-h-[80svh] place-items-center">
          <div className={`${cardClasses} p-6 font-extrabold text-slate-950`}>
            Loading portal...
          </div>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <main className={appShellClasses}>
              <div className="mx-auto grid min-h-[calc(100svh-56px)] w-full max-w-5xl items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
                <section className="grid gap-5">
                  <div className="inline-flex w-fit rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-extrabold uppercase tracking-wider text-slate-600 shadow-sm">
                    Secure portal
                  </div>
                  <h1 className="m-0 max-w-3xl text-[2.7rem] font-extrabold leading-[0.98] text-slate-950 sm:text-6xl">
                    Expense Tracker
                  </h1>
                </section>

                <form
                  className={`${cardClasses} grid gap-5 p-5 ring-1 ring-white sm:p-7`}
                  onSubmit={handleAuthSubmit}
                >
                  <div className="flex rounded-2xl border border-slate-200 bg-slate-100 p-1">
                    {(['login', 'signup'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`${buttonBaseClasses} min-h-10 flex-1 px-3 capitalize ${
                          authMode === mode
                            ? 'bg-white text-slate-950 shadow-[0_8px_20px_rgba(51,65,85,0.08)]'
                            : 'bg-transparent text-slate-600'
                        }`}
                        disabled={authSubmitting}
                        onClick={() => {
                          setAuthError('')
                          setAuthMode(mode)
                        }}
                      >
                        {mode === 'login' ? 'Login' : 'Create'}
                      </button>
                    ))}
                  </div>

                  <div>
                    <p className={sectionLabelClasses}>
                      {authMode === 'login' ? 'Welcome back' : 'New account'}
                    </p>
                    <h2 className="m-0 text-2xl font-extrabold text-slate-950">
                      {authMode === 'login' ? 'Login' : 'Create account'}
                    </h2>
                  </div>

                  <label className={labelClasses}>
                    Email
                    <input
                      className={fieldClasses}
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </label>

                  <label className={labelClasses}>
                    Password
                    <input
                      className={fieldClasses}
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      placeholder="At least 6 characters"
                      minLength={6}
                      required
                    />
                  </label>

                  {authError && (
                    <div className="rounded-xl border border-blue-500/20 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800">
                      {authError}
                    </div>
                  )}

                  <button
                    type="submit"
                    className={`${buttonBaseClasses} inline-flex w-full items-center justify-center gap-2 bg-emerald-700 text-white shadow-[0_14px_28px_rgba(16,124,99,0.18)]`}
                    disabled={authSubmitting}
                  >
                    {authSubmitting && (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    )}
                    {authSubmitting
                      ? authMode === 'login'
                        ? 'Logging in...'
                        : 'Creating account...'
                      : authMode === 'login'
                        ? 'Login'
                        : 'Create account'}
                  </button>
                </form>
              </div>
            </main>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute user={user}>
            <main className={appShellClasses}>
              {isMenuOpen && (
                <div className="fixed inset-0 z-40 lg:hidden">
                  <button
                    type="button"
                    className="absolute inset-0 bg-slate-950/30"
                    aria-label="Close menu"
                    onClick={() => setIsMenuOpen(false)}
                  />
                  <aside className="absolute inset-y-0 left-0 w-[min(86vw,340px)] overflow-y-auto border-r border-slate-200 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.16)]">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="text-sm font-extrabold uppercase tracking-wider text-slate-500">
                        Menu
                      </span>
                      <button
                        type="button"
                        className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-xl font-extrabold text-slate-700"
                        aria-label="Close menu"
                        onClick={() => setIsMenuOpen(false)}
                      >
                        ×
                      </button>
                    </div>
                    {renderMenu()}
                  </aside>
                </div>
              )}

              <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="hidden min-h-[calc(100svh-56px)] rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] lg:sticky lg:top-7 lg:block">
                  {renderMenu()}
                </aside>

                <section className="grid gap-4">
                  {renderTitleBar()}

                  {(isLoading || syncError) && (
                    <div
                      className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
                        syncError
                          ? 'border-blue-500/20 bg-blue-50 text-blue-800'
                          : 'border-emerald-500/20 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {syncError ? `Firebase sync error: ${syncError}` : 'Loading Firebase data...'}
                    </div>
                  )}

                  {renderFeature()}
                </section>
              </div>
            </main>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

export default App
