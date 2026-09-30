import { ReactiveComponent, type InputEvent, type KeyEvent } from '@geastack/core'
import {
  generateTotp,
  generateHotp,
  verifyTotp,
  base32Decode,
  parseOtpAuthUri,
  buildOtpAuthUri,
  parseMigrationUri,
  formatCode,
} from './crypto/totp'
import type { Account } from './types'
import { vaultService } from './services/VaultService'
import { vaultStore } from './stores/VaultStore'
import { uiStore } from './stores/UiStore'
import { platformHost } from './platform/host'
import UnlockView from './components/UnlockView'
import AccountCard from './components/AccountCard'
import './styles.css'

function safeCopy(text: string): void {
  platformHost.copy(text)
}

const AUTO_LOCK_MS = 5 * 60 * 1000 // 5 minutes inactivity

function vaultLocationLabel(): string {
  if (platformHost.platform === 'android') {
    if (!vaultStore.hasVault) return 'Bu Android cihazda henüz kasa yok'
    if (vaultStore.vaultPath.startsWith('content:')) return 'Dosyalardan seçilen kasa'
    return 'Bu Android cihazda FiOTP uygulama alanı · kasa.json'
  }
  if (platformHost.platform === 'ios') {
    if (!vaultStore.hasVault) return 'Bu iPhone’da henüz kasa yok'
    const selectedPath = vaultStore.vaultPath
    if (selectedPath.includes('/FiOTP/imported/')) {
      const fileName = selectedPath.split('/').pop() || 'kasa.json'
      return `Dosyalardan seçilen kasa · ${fileName}`
    }
    return 'Bu iPhone’da FiOTP uygulama alanı · kasa.json'
  }
  return vaultStore.vaultPath
}

function unlockErrorMessage(error: unknown): string {
  const message = (error as Error).message
  if (platformHost.platform === 'android') {
    if (/couldn.t be opened|no such file|does not exist|açılamadı/i.test(message)) {
      return 'Bu Android cihazdaki varsayılan kasa bulunamadı. “Var Olan Kasayı Aç…” ile şifreli kasa .json dosyanızı seçin.'
    }
    return message
  }
  // iOS container paths are long, change between installs, and are not
  // navigable in Files. Keep the actionable error without flooding the view.
  if (platformHost.platform === 'ios') {
    if (/couldn.t be opened|no such file|does not exist/i.test(message)) {
      return 'Bu iPhone’daki varsayılan kasa bulunamadı. “Var Olan Kasayı Aç…” ile Dosyalar’dan şifreli kasa .json dosyanızı seçin.'
    }
    return message
  }
  return `${message} Aktif kasa: ${vaultStore.vaultPath}`
}

export class App extends ReactiveComponent {
  lastActivityTime = 0

  private initialized = false
  private toastTimerId: any = null
  private copyTimerId: any = null

  init() {
    if (this.initialized) return
    this.initialized = true
    this.lastActivityTime = Date.now()
    // Start at the vault chooser. Creating a vault is an explicit action;
    // don't put first-run users directly into the creation form.
    this.loadState()
    this.startRafLoop()
  }

  startRafLoop() {
    // The native frame callback drives the clock, but its bookkeeping must
    // not mutate root component state and redraw the entire scrolling view.
    let lastTickSeconds = Math.floor(Date.now() / 1000)
    const loop = () => {
      const s = Math.floor(Date.now() / 1000)
      if (s !== lastTickSeconds) {
        lastTickSeconds = s
        vaultStore.tick(s)
        // Auto-lock check on each second boundary
        if (
          vaultStore.unlocked &&
          vaultStore.hasVault &&
          Date.now() - this.lastActivityTime > AUTO_LOCK_MS
        ) {
          this.lockVault()
        }
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  recordActivity() {
    this.lastActivityTime = Date.now()
  }

  refreshAccounts() {
    vaultStore.refresh()
  }

  rebuildAccountView() {
    // Counts and filtering are derived by VaultStore getters.
  }

  clearAccountView() {
    vaultStore.accounts = []
  }

  loadState(showCreateFormWhenEmpty = false) {
    try {
      vaultStore.loadStatus()
      uiStore.creatingVault = showCreateFormWhenEmpty && !vaultStore.hasVault
    } catch (e) {
      vaultStore.error = (e as Error).message
    }
  }

  showToast(msg: string) {
    uiStore.toastMessage = msg
    if (this.toastTimerId) clearTimeout(this.toastTimerId)
    this.toastTimerId = setTimeout(() => {
      uiStore.toastMessage = ''
    }, 2500)
  }

  copyCode(code: string, id: string) {
    this.recordActivity()
    const raw = code.replace(/\s/g, '')
    safeCopy(raw)
    uiStore.copiedId = id
    if (this.copyTimerId) clearTimeout(this.copyTimerId)
    this.copyTimerId = setTimeout(() => {
      uiStore.copiedId = ''
    }, 1500)
    this.showToast(`Kod panoya kopyalandı (${raw})`)
  }

  incrementHotp(id: string) {
    this.recordActivity()
    const accounts = vaultStore.accounts.map((a) => {
      if (a.id === id) {
        const next = (a.counter ?? 0) + 1
        return { ...a, counter: next }
      }
      return a
    })
    const changed = accounts.find((a) => a.id === id)
    if (changed) vaultService.updateAccount(id, { counter: changed.counter })
    vaultStore.refresh()
    this.showToast('HOTP sayacı artırıldı, yeni kod üretildi')
  }

  toggleFavorite(id: string) {
    this.recordActivity()
    const accounts = vaultStore.accounts.map((a) =>
      a.id === id ? { ...a, favorite: !a.favorite } : a
    )
    const changed = accounts.find((a) => a.id === id)
    if (changed) vaultService.updateAccount(id, { favorite: changed.favorite })
    vaultStore.refresh()
    uiStore.activeMenuAccountId = ''
  }

  setTag(id: string, tag: 'is' | 'kisisel') {
    this.recordActivity()
    const accounts = vaultStore.accounts.map((a) =>
      a.id === id ? { ...a, tags: a.tags.includes(tag) ? [] : [tag] } : a
    )
    const changed = accounts.find((a) => a.id === id)
    if (changed) vaultService.updateAccount(id, { tags: changed.tags })
    vaultStore.refresh()
    uiStore.activeMenuAccountId = ''
  }

  deleteAccount(id: string) {
    this.recordActivity()
    vaultService.removeAccount(id)
    this.refreshAccounts()
    uiStore.activeMenuAccountId = ''
    this.showToast('Hesap silindi')
  }

  lockVault() {
    vaultStore.lock()
    uiStore.passwordResetToken++
    vaultStore.error = ''
    uiStore.resetForLock()
  }

  unlockVault(password: string): boolean {
    this.recordActivity()
    try {
      if (!vaultStore.hasVault || uiStore.creatingVault) {
        throw new Error('Önce mevcut bir kasa seçin.')
      }
      if (!password.length) {
        throw new Error('Kasa parolasını girin.')
      }
      vaultStore.open(password, vaultStore.vaultPath)
      vaultStore.error = ''
      this.showToast(`Kasa açıldı · ${vaultStore.totalCount} hesap`)
      return true
    } catch (e) {
      vaultStore.error = `Kasa açılamadı: ${unlockErrorMessage(e)}`
      return false
    }
  }

  createVault(password: string, confirmation: string): boolean {
    this.recordActivity()
    try {
      if (!uiStore.creatingVault) throw new Error('Önce yeni kasa konumunu seçin.')
      if (password !== confirmation) {
        throw new Error('Parolalar eşleşmiyor.')
      }
      vaultStore.create(password, vaultStore.vaultPath)
      uiStore.creatingVault = false
      vaultStore.error = ''
      this.showToast('Güvenli boş kasa oluşturuldu')
      return true
    } catch (e) {
      const message = (e as Error).message
      if (message.includes('vault_exists') || message.includes('Bu konumda zaten bir kasa')) {
        // The selected destination may have appeared since the last status
        // check. Recover into the existing-vault flow instead of trapping the
        // user in a create form that can never succeed.
        try {
          const status = vaultStore.loadStatus()
          uiStore.creatingVault = false
          uiStore.passwordResetToken++
          vaultStore.error = status.hasVault
            ? 'Bu konumda zaten bir kasa var. Yeni parola oluşturmayın; mevcut kasa parolanızı girin.'
            : unlockErrorMessage(e)
        } catch {
          vaultStore.error = unlockErrorMessage(e)
        }
      } else {
        vaultStore.error = unlockErrorMessage(e)
      }
      return false
    }
  }

  chooseVault(openExisting: boolean) {
    vaultService.chooseVault(openExisting, (status) => {
      vaultStore.select(status)
      uiStore.creatingVault = !openExisting && !status.hasVault
      uiStore.passwordResetToken++
      vaultStore.error = ''
      if (openExisting && !status.hasVault) {
        vaultStore.error = 'Seçilen dosya kasa olarak bulunamadı. Şifreli FiOTP .json kasa dosyasını seçin.'
      } else if (!openExisting && status.hasVault) {
        vaultStore.error = 'Bu konumda zaten bir kasa var. Yeni parola oluşturmayın; mevcut kasa parolanızı girin.'
      }
    }, (e) => {
      if (!(e as Error).message.includes('iptal')) vaultStore.error = (e as Error).message
    })
  }

  scanQr() {
    platformHost.invokeAsync('qr.scanCamera', {}, (raw) => {
      try {
        const envelope = JSON.parse(raw) as { ok: boolean; data: { value: string } }
        uiStore.uriInput = envelope.data.value
        uiStore.addTab = 'uri'
        uiStore.addError = ''
        // Camera scanning is an import action, not merely a URI capture step.
        // Persist the decoded account(s) immediately so users do not have to
        // discover and press a second button after the scanner closes.
        this.saveNewAccount()
      } catch (e) {
        uiStore.addError = (e as Error).message
      }
    }, (e) => {
      if (!(e as Error).message.includes('iptal')) uiStore.addError = (e as Error).message
    })
  }

  openVerify(id: string) {
    this.recordActivity()
    uiStore.verifyAccountId = id
    uiStore.verifyInput = ''
    uiStore.verifyResult = ''
  }

  checkVerify() {
    this.recordActivity()
    const acc = vaultStore.accounts.find((a) => a.id === uiStore.verifyAccountId)
    if (!acc) return

    const entered = uiStore.verifyInput.trim().replace(/\s/g, '')

    if (acc.type === 'hotp') {
      const key = base32Decode(acc.secret)
      const start = acc.counter ?? 0
      for (let offset = 0; offset < 10; offset++) {
        const candidate = generateHotp(key, start + offset, {
          digits: acc.digits,
          algorithm: acc.algorithm,
        })
        let different = entered.length !== candidate.length ? 1 : 0
        for (let i = 0; i < candidate.length; i++) {
          different |= candidate.charCodeAt(i) ^ (entered.charCodeAt(i) || 0)
        }
        if (different === 0) {
          const nextCounter = start + offset + 1
          vaultService.updateAccount(acc.id, { counter: nextCounter })
          this.refreshAccounts()
          uiStore.verifyResult = 'success'
          this.showToast('HOTP sayacı güvenli biçimde ilerletildi')
          return
        }
      }
      uiStore.verifyResult = 'error'
      return
    }

    const valid = verifyTotp(
      acc.secret,
      entered,
      acc.period,
      acc.digits,
      acc.algorithm,
      1,
      Date.now()
    )

    uiStore.verifyResult = valid ? 'success' : 'error'
  }

  openQr(id: string) {
    this.recordActivity()
    const acc = vaultStore.accounts.find((a) => a.id === id)
    if (!acc) return
    uiStore.selectedQrIssuer = acc.issuer
    uiStore.selectedQrUri = buildOtpAuthUri(acc)
    uiStore.showQrModal = true
  }

  saveNewAccount() {
    this.recordActivity()
    uiStore.addError = ''

    if (uiStore.addTab === 'uri') {
      const u = uiStore.uriInput.trim()

      // 1. Google Authenticator Migration Protobuf URI
      if (u.startsWith('otpauth-migration://')) {
        try {
          const migrated = parseMigrationUri(u)
          if (migrated.length === 0) {
            uiStore.addError = 'Aktarılacak hesap bulunamadı.'
            return
          }
          const newAccounts: Account[] = []
          for (let i = 0; i < migrated.length; i++) {
            const m = migrated[i]
            const item: Account = {
              id: `act-${Date.now()}-${i}`,
              issuer: m.issuer,
              account: m.account,
              secret: m.secret,
              algorithm: m.algorithm,
              digits: m.digits,
              period: 30,
              type: m.type,
              counter: m.counter,
              favorite: false,
              tags: ['kisisel'],
              createdAt: Date.now(),
            }
            newAccounts.push(item)
          }
          const added = vaultService.addAccounts(newAccounts)
          this.refreshAccounts()
          uiStore.showAddModal = false
          const skipped = newAccounts.length - added
          if (added === 0) {
            this.showToast(`${skipped} hesap zaten kasada mevcut; yeni hesap eklenmedi`)
          } else if (skipped > 0) {
            this.showToast(`${added} hesap aktarıldı, ${skipped} mevcut hesap atlandı`)
          } else {
            this.showToast(`${added} hesap Google Authenticator'dan aktarıldı`)
          }
          return
        } catch (e) {
          uiStore.addError = `Google Authenticator aktarımı başarısız: ${(e as Error).message}`
          return
        }
      }

      // 2. Standard otpauth:// URI
      if (!u.startsWith('otpauth://')) {
        uiStore.addError = 'Geçersiz URI: "otpauth://totp/..." veya "otpauth-migration://..." olmalıdır.'
        return
      }

      try {
        const parsed = parseOtpAuthUri(u)
        const newAcc: Account = {
          id: `act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          issuer: parsed.issuer,
          account: parsed.account,
          secret: parsed.secret,
          algorithm: parsed.algorithm,
          digits: parsed.digits,
          period: parsed.period,
          type: parsed.type,
          counter: parsed.counter,
          favorite: false,
          tags: ['kisisel'],
          createdAt: Date.now(),
        }
        vaultService.addAccount(newAcc)
        this.refreshAccounts()
        uiStore.showAddModal = false
        this.showToast(`${parsed.issuer} hesabı eklendi`)
        return
      } catch (e) {
        uiStore.addError = `URI ayrıştırılamadı: ${(e as Error).message}`
        return
      }
    }

    // Manual Form
    const issuer = uiStore.newIssuer.trim()
    const account = uiStore.newAccount.trim()
    const secret = uiStore.newSecret.trim().toUpperCase().replace(/[\s-]/g, '')

    if (!issuer) {
      uiStore.addError = 'Lütfen servis / sağlayıcı adını girin.'
      return
    }
    if (!account) {
      uiStore.addError = 'Lütfen hesap adı / e-posta girin.'
      return
    }
    if (!secret) {
      uiStore.addError = 'Lütfen Base32 gizli anahtarını girin.'
      return
    }

    try {
      base32Decode(secret)
      if (uiStore.newType === 'totp') {
        generateTotp(secret, parseInt(uiStore.newPeriod, 10) || 30, uiStore.newDigits, uiStore.newAlgorithm, Date.now())
      }
    } catch (err) {
      uiStore.addError = `Geçersiz gizli anahtar: ${(err as Error).message}`
      return
    }

    const newAcc: Account = {
      id: `act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      issuer,
      account,
      secret,
      algorithm: uiStore.newAlgorithm,
      digits: uiStore.newDigits,
      period: parseInt(uiStore.newPeriod, 10) || 30,
      type: uiStore.newType,
      counter: parseInt(uiStore.newCounter, 10) || 0,
      favorite: false,
      tags: [uiStore.newTag],
      createdAt: Date.now(),
    }

    vaultService.addAccount(newAcc)
    this.refreshAccounts()
    uiStore.showAddModal = false
    this.showToast(`${issuer} hesabı eklendi`)
  }

  savePasswordChange() {
    this.recordActivity()
    uiStore.settingsError = ''
    uiStore.settingsMessage = ''

    if (uiStore.nextPass.length < 8) {
      uiStore.settingsError = 'Yeni parola en az 8 karakter olmalıdır.'
      return
    }
    if (uiStore.nextPass !== uiStore.confirmPass) {
      uiStore.settingsError = 'Yeni parolalar birbiriyle eşleşmiyor.'
      return
    }

    try {
      vaultService.changePassword(uiStore.currentPass, uiStore.nextPass)
      vaultStore.hasVault = true
      uiStore.currentPass = ''
      uiStore.nextPass = ''
      uiStore.confirmPass = ''
      uiStore.settingsMessage = 'Master parola başarıyla güncellendi.'
    } catch (e) {
      uiStore.settingsError = (e as Error).message
    }
  }

  importBackup(mode: 'merge' | 'replace' = 'merge') {
    this.recordActivity()
    uiStore.settingsError = ''
    uiStore.settingsMessage = ''

    vaultService.importBackup(uiStore.importJsonInput, mode, (count) => {
      this.refreshAccounts()
      uiStore.importJsonInput = ''
      uiStore.settingsMessage = `${count} hesap şifreli yedekten içe aktarıldı.`
    }, (e) => {
      uiStore.settingsError = `İçe aktarma hatası: ${(e as Error).message}`
    })
  }

  exportBackup() {
    this.recordActivity()
    uiStore.settingsError = ''
    vaultService.exportBackup((path) => {
      uiStore.settingsMessage = `Şifreli yedek kaydedildi: ${path}`
    }, (e) => {
      if (!(e as Error).message.includes('iptal')) uiStore.settingsError = (e as Error).message
    })
  }

  template() {
    this.init()

    const verifyAcc = vaultStore.accounts.find((a) => a.id === uiStore.verifyAccountId)

    return (
      <div
        class={`app-switch-root ${platformHost.platform === 'ios' || platformHost.platform === 'android' ? 'ios-layout' : platformHost.platform === 'linux' ? 'linux-layout' : platformHost.platform === 'windows' ? 'windows-layout' : 'macos-layout'}`}
        data-account-count={vaultStore.totalCount}
      >
        <div class="app-stage" style={{ display: vaultStore.phase === 'unlocked' ? 'none' : 'flex' }}>
          <UnlockView
            hasVault={vaultStore.hasVault}
            vaultLocation={vaultLocationLabel()}
            error={vaultStore.error}
            isIOS={platformHost.platform === 'ios' || platformHost.platform === 'android'}
            creatingVault={uiStore.creatingVault}
            resetToken={uiStore.passwordResetToken}
            busy={vaultStore.phase === 'opening'}
            onUnlock={(password: string) => this.unlockVault(password)}
            onCreate={(password: string, confirmation: string) => this.createVault(password, confirmation)}
            onSelectVault={() => this.chooseVault(true)}
            onCreateVault={() => this.chooseVault(false)}
            onCancelCreate={() => {
              uiStore.creatingVault = false
              uiStore.passwordResetToken++
            }}
          />
        </div>
        <div class="app-stage" style={{ display: vaultStore.phase === 'unlocked' ? 'flex' : 'none' }}>
      <div class="root-layout" onClick={() => this.recordActivity()}>
        {/* TitleBar (36px, surfaceLowest) */}
        <div class="title-bar">
          <span class="app-name">FiOTP</span>
          <div class="vault-pill">
            <span class="vault-label">Kasa:</span>
            <span class="vault-path">{vaultStore.vaultPath}</span>
          </div>
          <span class="aes-badge">AES-256-GCM</span>
        </div>

        {/* Toolbar (44px, surfaceLow) */}
        <div class="toolbar">
          <div class="search-box">
            <span class="search-icon">⌕</span>
            <input
              class="search-input"
              type="text"
              placeholder="Hesaplarda veya etiketlerde ara..."
              value={vaultStore.search}
              onInput={(e: InputEvent) => {
                this.recordActivity()
                vaultStore.setSearch(e.target.value)
              }}
            />
            <span class="kbd-badge">⌘K</span>
          </div>

          <button
            class="btn-primary-add"
            onClick={() => {
              this.recordActivity()
              uiStore.showAddModal = true
              uiStore.addError = ''
            }}
          >
            + Hesap Ekle
          </button>

          <button
            class="btn-ghost"
            onClick={() => {
              this.recordActivity()
              uiStore.showSettingsModal = true
            }}
          >
            Kasa & Yedek
          </button>

          <button
            class="btn-icon-sq"
            onClick={() => {
              this.recordActivity()
              uiStore.showSettingsModal = true
            }}
          >
            ⚙
          </button>
        </div>

        {/* Body: Sidebar + Main Content */}
        <div class="body-layout">
          {/* Sidebar (260px) */}
          <div class="sidebar">
            <div class="side-heading">Kategoriler</div>

            <button
              class={`side-item ${vaultStore.category === 'all' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('all')
              }}
            >
              <span class="side-entry-text">{`🔑   Tüm Kodlar   ${vaultStore.totalCount}`}</span>
            </button>

            <button
              class={`side-item ${vaultStore.category === 'favorites' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('favorites')
              }}
            >
              <span class="side-entry-text">{`★   Favoriler   ${vaultStore.favoriteCount}`}</span>
            </button>

            <button
              class={`side-item ${vaultStore.category === 'is' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('is')
              }}
            >
              <span class="side-entry-text">{`💼   İş & Kurumsal   ${vaultStore.workCount}`}</span>
            </button>

            <button
              class={`side-item ${vaultStore.category === 'kisisel' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('kisisel')
              }}
            >
              <span class="side-entry-text">{`👤   Kişisel   ${vaultStore.personalCount}`}</span>
            </button>

            <button
              class={`side-item ${vaultStore.category === 'hotp' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('hotp')
              }}
            >
              <span class="side-entry-text">{`⚡   HOTP Sayaçlı   ${vaultStore.hotpCount}`}</span>
            </button>

            {/* Status Card at Bottom */}
            <div class="status-card">
              <div class="status-row">
                <span class="status-label">KASA DURUMU</span>
                <div class="status-dot" />
              </div>
              <div class="status-title">AES-256-GCM</div>
              <div class="status-meta">Offline • Yerel kasa</div>
            </div>
          </div>

          {/* Main Content Area */}
          <div class="main-view">
            <div class="main-header">
              <div>
                <div class="live-badge">● Canlı TOTP & HOTP Motoru</div>
                <div class="main-title">Kasa Hesapları</div>
              </div>
              <button class="lock-btn" onClick={() => this.lockVault()}>
                Kasayı Kilitle  ⌘L
              </button>
            </div>

            <div class="pagination-row" aria-label="Hesap sayfaları">
              <span class="pagination-info">
                {`${vaultStore.pageStart}–${vaultStore.pageEnd} / ${vaultStore.visibleCount} hesap`}
              </span>
              <div class="pagination-actions">
                <button
                  class={`pagination-btn ${vaultStore.page === 0 ? 'disabled' : ''}`}
                  onClick={() => {
                    vaultStore.prevPage()
                  }}
                >
                  <span>← Önceki</span>
                </button>
                <span class="pagination-page">
                  {`${vaultStore.page + 1} / ${vaultStore.pageCount}`}
                </span>
                <button
                  class={`pagination-btn ${vaultStore.page + 1 >= vaultStore.pageCount ? 'disabled' : ''}`}
                  onClick={() => {
                    vaultStore.nextPage()
                  }}
                >
                  <span>Sonraki →</span>
                </button>
              </div>
            </div>

            {/* Filter Chips Row */}
            <div class="filters-row">
              <button
                class={`filter-chip ${vaultStore.category === 'all' ? 'active' : ''}`}
                onClick={() => {
                  vaultStore.setCategory('all')
                }}
              >
                {`Tümü (${vaultStore.totalCount})`}
              </button>

              <button
                class={`filter-chip ${vaultStore.category === 'is' ? 'active' : ''}`}
                onClick={() => {
                  vaultStore.setCategory('is')
                }}
              >
                {`İş (${vaultStore.workCount})`}
              </button>

              <button
                class={`filter-chip ${vaultStore.category === 'kisisel' ? 'active' : ''}`}
                onClick={() => {
                  vaultStore.setCategory('kisisel')
                }}
              >
                {`Kişisel (${vaultStore.personalCount})`}
              </button>

              <button
                class={`filter-chip ${vaultStore.category === 'hotp' ? 'active' : ''}`}
                onClick={() => {
                  vaultStore.setCategory('hotp')
                }}
              >
                {`HOTP (${vaultStore.hotpCount})`}
              </button>

              <div class="count-badge-text">{vaultStore.totalCount} Aktif</div>
            </div>

            {/* Cards List */}
            <div class="account-list-region">
              <div class="empty-box" style={{ display: vaultStore.liveAccounts.length === 0 ? 'flex' : 'none' }}>
                <div class="empty-title">Henüz hesap yok</div>
                <div class="empty-body">QR tarayarak, URI yapıştırarak veya manuel girerek hesap ekleyin.</div>
                <button class="btn-primary-add" style={{ marginTop: '12px' }} onClick={() => { uiStore.showAddModal = true }}>+ Hesap Ekle</button>
              </div>
              <div class="cards-list" style={{ display: vaultStore.liveAccounts.length === 0 ? 'none' : 'flex' }}>
                {vaultStore.liveAccounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    copied={uiStore.copiedId === account.id}
                    onToggleFavorite={(id: string) => this.toggleFavorite(id)}
                    onIncrementHotp={(id: string) => this.incrementHotp(id)}
                    onCopy={(id: string, code: string) => this.copyCode(code, id)}
                    onShowQr={(id: string) => this.openQr(id)}
                    onVerify={(id: string) => this.openVerify(id)}
                    onDelete={(id: string) => this.deleteAccount(id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Bar (28px, surfaceLowest) */}
        <div class="footer-bar">
          <div>Oto-Kilit: 5 dk hareketsizlik</div>
          <div>FiOTP v0.1.0 • Offline • AES-256-GCM Encrypted</div>
        </div>

        {/* Add Account Modal */}
        <div class={`overlay-backdrop ${uiStore.showAddModal ? 'is-open' : ''}`}>
            <div class="modal-box">
              <div class="modal-header-row">
                <span class="modal-heading">Hesap Ekle</span>
                <button
                  class="btn-close-x"
                  onClick={() => {
                    uiStore.showAddModal = false
                  }}
                >
                  ✕
                </button>
              </div>

              <div class="modal-tabs-row">
                <button
                  class={`modal-tab-btn ${uiStore.addTab === 'manual' ? 'active' : ''}`}
                  onClick={() => {
                    uiStore.addTab = 'manual'
                  }}
                >
                  Manuel
                </button>
                <button
                  class={`modal-tab-btn ${uiStore.addTab === 'uri' ? 'active' : ''}`}
                  onClick={() => {
                    uiStore.addTab = 'uri'
                  }}
                >
                  URI / Google Auth Aktarım
                </button>
              </div>

              <div class="alert-error" style={{ display: uiStore.addError ? 'block' : 'none' }}>{uiStore.addError}</div>

              <div class="modal-field-group" style={{ display: uiStore.addTab === 'uri' ? 'flex' : 'none' }}>
                  <span class="field-label">otpauth:// veya otpauth-migration:// URI</span>
                  <textarea
                    class="field-input textarea-tall"
                    placeholder="otpauth://totp/GitHub:user?secret=JBSWY3DPEHPK3PXP&#10;veya Google Authenticator migration URL yapıştırın"
                    value={uiStore.uriInput}
                    onInput={(e: InputEvent) => {
                      uiStore.uriInput = e.target.value
                    }}
                  />
                  <div style={{ fontSize: '11px', color: '#8c909f', marginTop: '4px' }}>
                    Google Authenticator QR aktarım bağlantıları (`otpauth-migration://`) da desteklenir.
                  </div>
                  <div style={{ fontSize: '11px', color: '#8c909f', marginTop: '8px', display: platformHost.platform === 'linux' || platformHost.platform === 'windows' ? 'block' : 'none' }}>
                    Bu sürümde kamera ile QR tarama yok. URI’yi buraya yapıştırabilir veya Manuel sekmesinden ekleyebilirsiniz.
                  </div>
                  <button class="btn-ghost" style={{ marginTop: '8px', display: platformHost.platform === 'linux' || platformHost.platform === 'windows' ? 'none' : 'flex' }} onClick={() => this.scanQr()}>
                    Kameradan QR Tara…
                  </button>
              </div>
              <div style={{ display: uiStore.addTab === 'manual' ? 'flex' : 'none', flexDirection: 'column', gap: '16px' }}>
                  <div class="modal-field-group">
                    <span class="field-label">Servis / Sağlayıcı</span>
                    <input
                      class="field-input"
                      type="text"
                      placeholder="Örn: GitHub, Google, AWS, Cloudflare"
                      value={uiStore.newIssuer}
                      onInput={(e: InputEvent) => {
                        uiStore.newIssuer = e.target.value
                      }}
                    />
                  </div>

                  <div class="modal-field-group">
                    <span class="field-label">Hesap Adı / E-posta</span>
                    <input
                      class="field-input"
                      type="text"
                      placeholder="kullanici@alanadi.com"
                      value={uiStore.newAccount}
                      onInput={(e: InputEvent) => {
                        uiStore.newAccount = e.target.value
                      }}
                    />
                  </div>

                  <div class="modal-field-group">
                    <span class="field-label">Gizli Anahtar (Base32)</span>
                    <input
                      class="field-input"
                      type="text"
                      placeholder="JBSWY3DPEHPK3PXP"
                      value={uiStore.newSecret}
                      onInput={(e: InputEvent) => {
                        uiStore.newSecret = e.target.value
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
                    <div class="modal-field-group" style={{ flex: 1 }}>
                      <span class="field-label">Tip</span>
                      <div style={{ display: 'flex', flexDirection: 'row', gap: '4px' }}>
                        <button
                          class={`modal-tab-btn ${uiStore.newType === 'totp' ? 'active' : ''}`}
                          onClick={() => {
                            uiStore.newType = 'totp'
                          }}
                        >
                          TOTP (Zaman)
                        </button>
                        <button
                          class={`modal-tab-btn ${uiStore.newType === 'hotp' ? 'active' : ''}`}
                          onClick={() => {
                            uiStore.newType = 'hotp'
                          }}
                        >
                          HOTP (Sayaç)
                        </button>
                      </div>
                    </div>

                    <div class="modal-field-group" style={{ flex: 1 }}>
                      <span class="field-label">Algoritma</span>
                      <div style={{ display: 'flex', flexDirection: 'row', gap: '4px' }}>
                        <button
                          class={`modal-tab-btn ${uiStore.newAlgorithm === 'SHA1' ? 'active' : ''}`}
                          onClick={() => {
                            uiStore.newAlgorithm = 'SHA1'
                          }}
                        >
                          SHA1
                        </button>
                        <button
                          class={`modal-tab-btn ${uiStore.newAlgorithm === 'SHA256' ? 'active' : ''}`}
                          onClick={() => {
                            uiStore.newAlgorithm = 'SHA256'
                          }}
                        >
                          SHA256
                        </button>
                        <button
                          class={`modal-tab-btn ${uiStore.newAlgorithm === 'SHA512' ? 'active' : ''}`}
                          onClick={() => {
                            uiStore.newAlgorithm = 'SHA512'
                          }}
                        >
                          SHA512
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
                    <div class="modal-field-group" style={{ flex: 1 }}>
                      <span class="field-label">Kategori</span>
                      <div style={{ display: 'flex', flexDirection: 'row', gap: '4px' }}>
                        <button
                          class={`modal-tab-btn ${uiStore.newTag === 'kisisel' ? 'active' : ''}`}
                          onClick={() => {
                            uiStore.newTag = 'kisisel'
                          }}
                        >
                          Kişisel
                        </button>
                        <button
                          class={`modal-tab-btn ${uiStore.newTag === 'is' ? 'active' : ''}`}
                          onClick={() => {
                            uiStore.newTag = 'is'
                          }}
                        >
                          İş
                        </button>
                      </div>
                    </div>

                      <div class="modal-field-group" style={{ flex: 1, display: uiStore.newType === 'totp' ? 'flex' : 'none' }}>
                        <span class="field-label">Süre (sn)</span>
                        <input
                          class="field-input"
                          type="text"
                          value={uiStore.newPeriod}
                          onInput={(e: InputEvent) => {
                            uiStore.newPeriod = e.target.value
                          }}
                        />
                      </div>
                      <div class="modal-field-group" style={{ flex: 1, display: uiStore.newType === 'hotp' ? 'flex' : 'none' }}>
                        <span class="field-label">Başlangıç Sayacı</span>
                        <input
                          class="field-input"
                          type="text"
                          value={uiStore.newCounter}
                          onInput={(e: InputEvent) => {
                            uiStore.newCounter = e.target.value
                          }}
                        />
                      </div>
                  </div>
              </div>

              <div class="modal-actions-row">
                <button
                  class="btn-ghost"
                  onClick={() => {
                    uiStore.showAddModal = false
                  }}
                >
                  İptal
                </button>
                <button class="btn-primary-add" onClick={() => this.saveNewAccount()}>
                  Hesap Ekle
                </button>
              </div>
            </div>
          </div>

        {/* QR Code Sharing Modal */}
        <div class={`overlay-backdrop ${uiStore.showQrModal ? 'is-open' : ''}`}>
            <div class="modal-box">
              <div class="modal-header-row">
                <span class="modal-heading">QR / URI Paylaşımı — {uiStore.selectedQrIssuer}</span>
                <button
                  class="btn-close-x"
                  onClick={() => {
                    uiStore.showQrModal = false
                  }}
                >
                  ✕
                </button>
              </div>

              <div class="modal-field-group">
                <span class="field-label">Standart otpauth URI</span>
                <textarea
                  class="field-input textarea-mono"
                  value={uiStore.selectedQrUri}
                />
              </div>

              <div class="modal-actions-row">
                <button
                  class="btn-primary-add"
                  onClick={() => {
                    safeCopy(uiStore.selectedQrUri)
                    this.showToast('otpauth URI panoya kopyalandı')
                  }}
                >
                  📋 URI Kopyala
                </button>
                <button
                  class="btn-ghost"
                  onClick={() => {
                    uiStore.showQrModal = false
                  }}
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>

        {/* Verify Modal */}
        <div class={`overlay-backdrop ${uiStore.verifyAccountId ? 'is-open' : ''}`}>
            <div class="modal-box">
              <div class="modal-header-row">
                <span class="modal-heading">Kod Doğrula — {verifyAcc?.issuer}</span>
                <button
                  class="btn-close-x"
                  onClick={() => {
                    uiStore.verifyAccountId = ''
                  }}
                >
                  ✕
                </button>
              </div>

              <div class="modal-field-group">
                <span class="field-label">6 Haneli Kod Girin</span>
                <input
                  class="field-input"
                  type="text"
                  placeholder="123456"
                  value={uiStore.verifyInput}
                  onInput={(e: InputEvent) => {
                    uiStore.verifyInput = e.target.value
                  }}
                  onKeyDown={(e: KeyEvent) => {
                    if (e.keyCode === 13) this.checkVerify()
                  }}
                />
              </div>

              <div class="alert-success" style={{ display: uiStore.verifyResult === 'success' ? 'block' : 'none' }}>✓ Kod geçerli! Doğrulama başarılı.</div>
              <div class="alert-error" style={{ display: uiStore.verifyResult === 'error' ? 'block' : 'none' }}>✕ Kod geçersiz veya süresi dolmuş.</div>

              <div class="modal-actions-row">
                <button
                  class="btn-ghost"
                  onClick={() => {
                    uiStore.verifyAccountId = ''
                  }}
                >
                  Kapat
                </button>
                <button class="btn-primary-add" onClick={() => this.checkVerify()}>
                  Doğrula
                </button>
              </div>
            </div>
          </div>

        {/* Settings & Backup Modal */}
        <div class={`overlay-backdrop ${uiStore.showSettingsModal ? 'is-open' : ''}`}>
            <div class="modal-box" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
              <div class="modal-header-row">
                <span class="modal-heading">Kasa & Ayarlar</span>
                <button
                  class="btn-close-x"
                  onClick={() => {
                    uiStore.showSettingsModal = false
                  }}
                >
                  ✕
                </button>
              </div>

              <div class="alert-success" style={{ display: uiStore.settingsMessage ? 'block' : 'none' }}>{uiStore.settingsMessage}</div>
              <div class="alert-error" style={{ display: uiStore.settingsError ? 'block' : 'none' }}>{uiStore.settingsError}</div>

              <div class="modal-field-group">
                <span class="field-label">Aktif Kasa Konumu</span>
                <div class="field-input" style={{ color: '#4edea3' }}>
                  {vaultStore.vaultPath}
                </div>
              </div>

              <div class="modal-field-group">
                <span class="field-label">Master Parola Değiştir</span>
                <input
                  class="field-input"
                  type="password"
                  placeholder="Mevcut parola"
                  value={uiStore.currentPass}
                  onInput={(e: InputEvent) => {
                    uiStore.currentPass = e.target.value
                  }}
                />
                <input
                  class="field-input"
                  style={{ marginTop: '4px' }}
                  type="password"
                  placeholder="Yeni parola"
                  value={uiStore.nextPass}
                  onInput={(e: InputEvent) => {
                    uiStore.nextPass = e.target.value
                  }}
                />
                <input
                  class="field-input"
                  style={{ marginTop: '4px' }}
                  type="password"
                  placeholder="Yeni parolayı onayla"
                  value={uiStore.confirmPass}
                  onInput={(e: InputEvent) => {
                    uiStore.confirmPass = e.target.value
                  }}
                />
                <button
                  class="btn-ghost"
                  style={{ marginTop: '6px' }}
                  onClick={() => this.savePasswordChange()}
                >
                  Parolayı Güncelle
                </button>
              </div>

              <div class="modal-field-group">
                <span class="field-label">Şifreli Kasa Yedeği</span>
                <button
                  class="btn-ghost"
                  onClick={() => this.exportBackup()}
                >
                  Şifreli Yedeği Dışa Aktar…
                </button>
              </div>

              <div class="modal-field-group">
                <span class="field-label">Şifreli Yedekten Geri Yükle</span>
                <input
                  class="field-input"
                  type="password"
                  placeholder="Yedek master parolası"
                  value={uiStore.importJsonInput}
                  onInput={(e: InputEvent) => {
                    uiStore.importJsonInput = e.target.value
                  }}
                />
                <button
                  class="btn-ghost"
                  style={{ marginTop: '6px' }}
                  onClick={() => this.importBackup('merge')}
                >
                  Birleştirerek İçe Aktar…
                </button>
                <button
                  class="btn-ghost"
                  style={{ marginTop: '6px' }}
                  onClick={() => this.importBackup('replace')}
                >
                  Kasayı Yedekle Değiştir…
                </button>
              </div>

              <div class="modal-actions-row">
                <button
                  class="btn-primary-add"
                  onClick={() => {
                    uiStore.showSettingsModal = false
                  }}
                >
                  Tamam
                </button>
              </div>
            </div>
          </div>

        {/* Floating Toast Notification */}
        <div class={`toast-bar ${uiStore.toastMessage ? 'is-open' : ''}`}>
            <span class="toast-check">✓</span>
            <span>{uiStore.toastMessage}</span>
        </div>
      </div>
        </div>
      </div>
    )
  }
}
