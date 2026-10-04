import type { Account } from '../types'
import { platformHost, type PlatformHost } from '../platform/host'

export interface VaultStatus {
  hasVault: boolean
  unlocked: boolean
  path: string
}

interface OpenResult {
  path: string
  plaintext: string
  accountCount: number
  recoveredFromBackup?: boolean
}

interface StatusEnvelope {
  ok: boolean
  data: { exists: boolean; path: string }
}

interface PathEnvelope {
  ok: boolean
  data: { path: string; exported?: boolean }
}

interface OpenEnvelope {
  ok: boolean
  data: OpenResult
}

interface VaultPayload {
  schema: 1
  accounts: Account[]
}

const VAULT_PATH_KEY = 'fiotp_selected_vault_path_v1'
type ServiceSuccess<T> = (value: T) => void
type ServiceFailure = (error: Error) => void

function validateAccounts(value: unknown): Account[] {
  if (!Array.isArray(value)) throw new Error('Kasa hesap listesi içermiyor.')
  const accounts = value as Account[]
  const ids = new Set<string>()
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]
    if (!a || typeof a.id !== 'string' || typeof a.issuer !== 'string' ||
        typeof a.account !== 'string' || typeof a.secret !== 'string' ||
        (a.type !== 'totp' && a.type !== 'hotp')) {
      throw new Error('Kasada geçersiz hesap kaydı bulundu.')
    }
    if (ids.has(a.id)) throw new Error('Kasada yinelenen hesap kimliği bulundu.')
    ids.add(a.id)
    a.favorite = !!a.favorite
    if (!Array.isArray(a.tags)) a.tags = []
  }
  // Do not map/clone here. geatsc's native backend can currently emit an
  // empty ArrayObject for that transformation even when the decoded vault
  // array contains records.
  return accounts
}

export class VaultService {
  private accounts: Account[] = []
  private unlocked = false
  private path = ''
  private pathLoaded = false

  constructor(private readonly host: PlatformHost = platformHost) {}

  status(): VaultStatus {
    if (!this.host.available) {
      return { hasVault: false, unlocked: this.unlocked, path: 'Web önizlemesi — kalıcı kasa yok' }
    }
    this.loadRememberedPath()
    if (!this.path) {
      const defaultEnvelope = JSON.parse(this.host.invoke('vault.defaultPath')) as PathEnvelope
      this.path = defaultEnvelope.data.path
    }
    if (this.host.platform === 'ios' || this.host.platform === 'android') {
      const discovered = JSON.parse(this.host.invoke('vault.discover', { preferredPath: this.path })) as StatusEnvelope
      this.path = discovered.data.path
      this.rememberPath(this.path)
      return { hasVault: discovered.data.exists, unlocked: this.unlocked, path: discovered.data.path }
    }
    const envelope = JSON.parse(this.host.invoke('vault.status', { path: this.path })) as StatusEnvelope
    const native = envelope.data
    this.path = native.path
    return { hasVault: native.exists, unlocked: this.unlocked, path: native.path }
  }

  create(password: string, path?: string): VaultStatus {
    this.requireStrongPassword(password)
    const target = path || this.path
    const payload: VaultPayload = { schema: 1, accounts: [] }
    const envelope = JSON.parse(this.host.invoke('vault.create', {
      path: target,
      password,
      plaintext: JSON.stringify(payload),
    })) as PathEnvelope
    const result = envelope.data
    this.path = result.path
    this.rememberPath(result.path)
    this.accounts = []
    this.unlocked = true
    return this.status()
  }

  open(password: string, path?: string): VaultStatus {
    const envelope = JSON.parse(this.host.invoke('vault.open', { path: path || this.path, password })) as OpenEnvelope
    const result = envelope.data
    const payload = JSON.parse(result.plaintext) as VaultPayload
    if (payload.schema !== 1) throw new Error('Bu kasa sürümü desteklenmiyor.')
    this.accounts = validateAccounts(payload.accounts)
    if (this.accounts.length !== result.accountCount) {
      throw new Error('Kasa hesapları çözülürken tutarsızlık algılandı.')
    }
    this.path = result.path
    this.rememberPath(result.path)
    this.unlocked = true
    return this.status()
  }

  lock(): void {
    if (this.host.available) this.host.invoke('vault.lock')
    for (const account of this.accounts) account.secret = ''
    this.accounts = []
    this.unlocked = false
  }

  listAccounts(): Account[] {
    this.requireUnlocked()
    // Keep the validated vault array intact. geatsc's native backend currently
    // loses elements when an array is cloned across this service boundary.
    return this.accounts
  }

  addAccount(account: Account): void {
    this.requireUnlocked()
    if (this.accounts.some((a) => a.id === account.id ||
      (a.type === account.type && a.issuer === account.issuer && a.account === account.account && a.secret === account.secret))) {
      throw new Error('Bu hesap kasada zaten bulunuyor.')
    }
    this.accounts = [{ ...account, tags: [...account.tags] }, ...this.accounts]
    this.persist()
  }

  addAccounts(accounts: Account[]): number {
    let added = 0
    for (const account of accounts) {
      if (this.accounts.some((a) => a.type === account.type && a.issuer === account.issuer &&
          a.account === account.account && a.secret === account.secret)) continue
      this.accounts.unshift({ ...account, tags: [...account.tags] })
      added++
    }
    if (added) this.persist()
    return added
  }

  removeAccount(id: string): void {
    this.requireUnlocked()
    this.accounts = this.accounts.filter((a) => a.id !== id)
    this.persist()
  }

  updateAccount(id: string, patch: Partial<Account>): void {
    this.requireUnlocked()
    this.accounts = this.accounts.map((a) => a.id === id ? { ...a, ...patch } : a)
    this.persist()
  }

  changePassword(currentPassword: string, newPassword: string): void {
    this.requireUnlocked()
    this.requireStrongPassword(newPassword)
    this.host.invoke('vault.changePassword', {
      path: this.path,
      currentPassword,
      newPassword,
      plaintext: this.serialize(),
    })
  }

  chooseVault(openExisting: boolean, onSuccess: ServiceSuccess<VaultStatus>, onFailure: ServiceFailure): void {
    this.host.invokeAsync(openExisting ? 'dialog.openVault' : 'dialog.saveVault', {}, (raw) => {
      try {
        const envelope = JSON.parse(raw) as PathEnvelope
        const selectedPath = envelope.data.path
        if (openExisting) this.rememberPath(selectedPath)
        const statusEnvelope = JSON.parse(this.host.invoke('vault.status', { path: selectedPath })) as StatusEnvelope
        onSuccess({ hasVault: statusEnvelope.data.exists, unlocked: false, path: statusEnvelope.data.path })
      } catch (error) {
        onFailure(error as Error)
      }
    }, onFailure)
  }

  exportBackup(onSuccess: ServiceSuccess<string>, onFailure: ServiceFailure): void {
    try {
      this.requireUnlocked()
      this.host.invokeAsync('dialog.saveBackup', { source: this.path }, (raw) => {
        try {
          const envelope = JSON.parse(raw) as PathEnvelope
          if (!envelope.data.exported) this.host.invoke('vault.export', { source: this.path, destination: envelope.data.path })
          onSuccess(envelope.data.path)
        } catch (error) {
          onFailure(error as Error)
        }
      }, onFailure)
    } catch (error) {
      onFailure(error as Error)
    }
  }

  importBackup(password: string, mode: 'merge' | 'replace', onSuccess: ServiceSuccess<number>, onFailure: ServiceFailure): void {
    try {
      this.requireUnlocked()
      this.host.invokeAsync('dialog.openBackup', {}, (raw) => {
        try {
          const selectedEnvelope = JSON.parse(raw) as PathEnvelope
          const openEnvelope = JSON.parse(this.host.invoke('vault.readExternal', {
            path: selectedEnvelope.data.path,
            password,
          })) as OpenEnvelope
          const result = openEnvelope.data
          const payload = JSON.parse(result.plaintext) as VaultPayload
          if (payload.schema !== 1) throw new Error('Yedek sürümü desteklenmiyor.')
          const incoming = validateAccounts(payload.accounts)
          if (mode === 'replace') {
            this.accounts = incoming
            this.persist()
            onSuccess(incoming.length)
            return
          }
          onSuccess(this.addAccounts(incoming))
        } catch (error) {
          onFailure(error as Error)
        }
      }, onFailure)
    } catch (error) {
      onFailure(error as Error)
    }
  }

  private persist(): void {
    this.host.invoke('vault.save', { path: this.path, plaintext: this.serialize() })
  }

  private serialize(): string {
    return JSON.stringify({ schema: 1, accounts: this.accounts } as VaultPayload)
  }

  private requireUnlocked(): void {
    if (!this.unlocked) throw new Error('Kasa kilitli.')
  }

  private requireStrongPassword(password: string): void {
    if (password.length < 8) throw new Error('Master parola en az 8 karakter olmalıdır.')
  }

  private loadRememberedPath(): void {
    if (this.pathLoaded) return
    this.pathLoaded = true
    if (this.host.available) {
      try {
        const envelope = JSON.parse(this.host.invoke('vault.selectedPath')) as PathEnvelope
        if (envelope.data.path) {
          this.path = envelope.data.path
          return
        }
      } catch {
        // Older hosts fall back to the web-compatible preference below.
      }
    }
    if (this.host.platform === 'web') {
      try {
        const saved = localStorage.getItem(VAULT_PATH_KEY)
        if (saved) this.path = saved
      } catch {
        // Web preview or unavailable storage: use the documented default path.
      }
    }
  }

  private rememberPath(path: string): void {
    this.path = path
    this.pathLoaded = true
    if (this.host.available) {
      this.host.invoke('vault.rememberPath', { path })
    }
    if (this.host.platform === 'web') {
      try {
        localStorage.setItem(VAULT_PATH_KEY, path)
      } catch {
        // Path persistence is a convenience; vault security does not depend on it.
      }
    }
  }
}

export const vaultService = new VaultService()
