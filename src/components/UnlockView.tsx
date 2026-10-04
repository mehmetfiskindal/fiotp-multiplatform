import { ReactiveComponent, type GeaElement, type InputEvent, type KeyEvent } from '@geastack/core'

export interface UnlockViewProps {
  hasVault: boolean
  vaultLocation: string
  error: string
  isIOS: boolean
  creatingVault: boolean
  resetToken: number
  busy: boolean
  onUnlock: (password: string) => boolean
  onCreate: (password: string, confirmation: string) => boolean
  onSelectVault: () => void
  onCreateVault: () => void
  onCancelCreate: () => void
}

export default class UnlockView extends ReactiveComponent<GeaElement, UnlockViewProps> {
  password = ''
  confirmPassword = ''
  private lastResetToken = -1

  template(props: UnlockViewProps) {
    const {
      hasVault, vaultLocation, error, isIOS, creatingVault, busy,
      onUnlock, onCreate, onSelectVault, onCreateVault, onCancelCreate,
    } = props

    if (this.lastResetToken !== props.resetToken) {
      this.lastResetToken = props.resetToken
      this.password = ''
      this.confirmPassword = ''
    }

    return (
    <div class="unlock-wrapper">
      <div class="unlock-box">
        <div class="unlock-badge">F</div>
        <div class="unlock-heading">FiOTP</div>
        <div class="unlock-sub">Yerel, şifreli 2FA kasası</div>

        <div class="vault-row-card">
          <div class="vault-info-col">
            <span class="vault-info-label">Kasa Konumu</span>
            <span class="vault-info-path">{vaultLocation}</span>
          </div>
        </div>

        {isIOS ? (
          <div class="ios-vault-location-hint">
            Kasa dosyası uygulamanın özel alanında saklanır. Cihazlar arasında taşımak için şifreli yedek kullanın.
          </div>
        ) : null}

        {error ? <div class="alert-error" style={{ width: '100%' }}>{error}</div> : null}

        <div class="create-vault-panel" style={{ display: creatingVault ? 'flex' : 'none' }}>
          <div class="create-vault-title">Yeni kasa oluştur</div>
          <input
            class="password-input create-password-input"
            type="password"
            placeholder="Yeni master parola (en az 8 karakter)"
            value={this.password}
            onInput={(e: InputEvent) => { this.password = e.target.value }}
          />
          <input
            class="password-input create-password-input"
            type="password"
            placeholder="Master parolayı doğrula"
            value={this.confirmPassword}
            onInput={(e: InputEvent) => { this.confirmPassword = e.target.value }}
            onKeyDown={(e: KeyEvent) => { if (e.keyCode === 13) this.submitCreate(onCreate) }}
          />
          <div class="create-vault-actions">
            <button class="btn-secondary-half" onClick={() => { this.clearPasswords(); onCancelCreate() }}>Vazgeç</button>
            <button class="btn-create-submit" onClick={() => this.submitCreate(onCreate)}>
              Yeni Kasayı Oluştur →
            </button>
          </div>
        </div>

        <div
          class="unlock-password-label"
          style={{ display: !creatingVault && hasVault ? 'block' : 'none' }}
        >
          Kasa parolası
        </div>
        <div
          class="input-submit-wrap"
          style={{ display: !creatingVault && hasVault ? 'flex' : 'none' }}
        >
          <input
            class="password-input"
            type="password"
            placeholder="Parolanızı girin"
            value={this.password}
            onInput={(e: InputEvent) => { this.password = e.target.value }}
            onKeyDown={(e: KeyEvent) => { if (e.keyCode === 13) this.submitUnlock(onUnlock) }}
          />
          <button class="btn-open-submit" onClick={() => this.submitUnlock(onUnlock)}>
            {busy ? 'Kasa açılıyor…' : 'Kasayı Aç →'}
          </button>
        </div>

        <div
          class="empty-vault-notice"
          style={{ display: !creatingVault && !hasVault && !error ? 'block' : 'none' }}
        >
          {isIOS
            ? 'Bu iPhone’da henüz kasa yok. Var olan şifreli kasa dosyanızı seçin veya bu iPhone’da yeni kasa oluşturun.'
            : 'Bu konumda kasa yok. Mevcut bir kasa seçin veya yeni kasa oluşturun.'}
        </div>

        <div class="unlock-hint">● 5 dk hareketsizlikte oto-kilit</div>

        <div class="unlock-actions-row" style={{ display: creatingVault ? 'none' : 'flex' }}>
          <button class="btn-secondary-half" onClick={onSelectVault}>
            {isIOS
              ? (hasVault ? 'Başka Kasa Dosyası Seç…' : 'Kasa Dosyası Seç…')
              : 'Var Olan Kasayı Aç…'}
          </button>
          <button class="btn-secondary-half" onClick={onCreateVault}>
            {isIOS ? 'Bu iPhone’da Yeni Kasa Oluştur…' : 'Yeni Konumda Kasa Oluştur…'}
          </button>
        </div>
      </div>

      <div class="unlock-footer-text">FiOTP v0.1.0 • Offline • AES-256-GCM Encrypted</div>
    </div>
    )
  }

  private submitUnlock(onUnlock: (password: string) => boolean) {
    if (onUnlock(this.password)) this.clearPasswords()
  }

  private submitCreate(onCreate: (password: string, confirmation: string) => boolean) {
    if (onCreate(this.password, this.confirmPassword)) this.clearPasswords()
  }

  private clearPasswords() {
    this.password = ''
    this.confirmPassword = ''
  }
}
