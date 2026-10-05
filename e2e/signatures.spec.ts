import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { shortFingerprint } from '../core/validate/signature.ts'
import { richFiles, writeRichWsnp } from '../fixtures/build.ts'
import { ecdsaSigner, ed25519Signer, fingerprintHex, writeSignedWsnp, type SignedOptions, type Signer } from '../fixtures/sign.ts'

// End-to-end: the signature of the manifest (FORMAT.md section 12, docs/MANIFEST-SIGNING.md). Unzipping a file and editing its manifest
// makes it not valid; who signed it is the user's to trust.
const noSandbox = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []
let dir: string
let app: ElectronApplication | undefined

test.beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-e2e-sig-'))))
test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const profile = () => path.join(dir, 'profile')
async function launch(...files: string[]): Promise<Page> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile()}`, ...noSandbox, ...files] })
  const page = await app.firstWindow()
  await page.getByTestId('titlebar').waitFor()
  return page
}
async function signed(name: string, title: string, signer: Signer, options: SignedOptions = {}) {
  const file = path.join(dir, name)
  await writeSignedWsnp(file, richFiles(), signer, { title, url: 'https://harbortimes.example/', ...options })
  return file
}
const status = (page: Page) => page.getByRole('contentinfo')
const metadata = (page: Page) => page.getByLabel('Metadata', { exact: true })
const invalid = (page: Page) => page.getByRole('alert').filter({ hasText: 'This snapshot is not valid' })
// Through the tab's context menu, which every system has (macOS has its menu outside the window).
const showMetadata = async (page: Page) => {
  await page.getByRole('tab').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show Metadata' }).click()
}

test.describe('a file that is not signed', () => {
  test('opens, with a quiet notice in the status bar and the metadata: the metadata is not protected', async () => {
    const file = path.join(dir, 'plain.wsnp')
    await writeRichWsnp(file, { title: 'Plain' })
    const page = await launch(file)
    await expect(status(page)).toContainText('Not signed')
    await expect(invalid(page)).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await showMetadata(page)
    await expect(metadata(page)).toContainText('if someone unzipped the file and edited the manifest, the viewer cannot tell')
  })
})

test.describe('a file that is signed', () => {
  test('shows the signer, asks whether to trust a key it does not know, and remembers the answer', async () => {
    const signer = ed25519Signer()
    const short = shortFingerprint(fingerprintHex(signer))
    const file = await signed('a.wsnp', 'Signed page', signer)
    let page = await launch(file)
    await expect(invalid(page)).toHaveCount(0)
    await expect(status(page)).toContainText('Signed (new key)')
    await showMetadata(page)
    await expect(metadata(page)).toContainText(`Signed by a key this viewer does not know yet (${short})`)
    await expect(metadata(page)).toContainText('Ed25519')
    await expect(metadata(page)).toContainText(short)
    await page.getByLabel('Name (optional)').fill('PageKeep on this computer')
    await page.getByRole('button', { name: 'Trust this signer' }).click()
    await expect(metadata(page)).toContainText(`Signed by PageKeep on this computer (${short})`)
    await expect(status(page)).not.toContainText('new key')
    await expect(status(page)).toContainText('Signed')
    // The answer is in the profile, and is there the next time.
    expect(JSON.parse(fs.readFileSync(path.join(profile(), 'trusted-signers.json'), 'utf8'))[fingerprintHex(signer)]).toMatchObject({ name: 'PageKeep on this computer' })
    await app!.close()
    page = await launch(file)
    await expect(status(page)).toContainText('Signed')
    await expect(status(page)).not.toContainText('new key')
    await showMetadata(page)
    await expect(metadata(page)).toContainText('Signed by PageKeep on this computer')
    await page.getByRole('button', { name: 'Stop trusting' }).click()
    await expect(status(page)).toContainText('Signed (new key)')
  })

  test('a file signed with ECDSA P-256 checks too', async () => {
    const signer = ecdsaSigner()
    const page = await launch(await signed('e.wsnp', 'ECDSA page', signer))
    await expect(invalid(page)).toHaveCount(0)
    await showMetadata(page)
    await expect(metadata(page)).toContainText('ECDSA-P256-SHA256')
    await expect(metadata(page)).toContainText(shortFingerprint(fingerprintHex(signer)))
  })

  test('trusting one key does not make another one trusted: a file signed again by someone else shows a new key', async () => {
    const mine = ed25519Signer()
    const theirs = ed25519Signer()
    fs.mkdirSync(profile(), { recursive: true })
    fs.writeFileSync(path.join(profile(), 'trusted-signers.json'), JSON.stringify({ [fingerprintHex(mine)]: { name: 'Mine', trustedAt: '2026-09-30T00:00:00.000Z' } }))
    const page = await launch(await signed('m.wsnp', 'Mine page', mine), await signed('t.wsnp', 'Theirs page', theirs))
    await page.getByRole('tab', { name: /Mine page/ }).click()
    await expect(status(page)).toContainText('Signed')
    await expect(status(page)).not.toContainText('new key')
    await page.getByRole('tab', { name: /Theirs page/ }).click()
    await expect(status(page)).toContainText('Signed (new key)')
  })
})

test.describe('a file whose manifest was edited after it was signed is not valid', () => {
  test('editing the title (what anyone does who unzips the file) holds the page back, and says the manifest was edited', async () => {
    const page = await launch(await signed('edited.wsnp', 'Original title', ed25519Signer(), { editAfterSigning: (m) => (m.title = 'A title someone else wrote') }))
    await expect(invalid(page)).toBeVisible()
    await expect(invalid(page)).toContainText('The metadata of the snapshot was edited after it was signed')
    await expect(status(page)).toContainText('Invalid')
    await expect(page.locator('iframe[title^="Snapshot:"]')).toBeHidden()
    await invalid(page).getByRole('button', { name: 'Show Metadata' }).click()
    await expect(metadata(page)).toContainText('The manifest was edited after it was signed.')
    // The user can still look.
    await page.getByRole('tab', { name: /A title someone else wrote/ }).first().click()
    await invalid(page).getByRole('button', { name: 'Show Anyway' }).click()
    await expect(page.frameLocator('iframe[title^="Snapshot:"]').locator('h2')).toHaveText('Item 1')
  })

  test('editing the address the page came from, or the date, is caught the same way', async () => {
    const a = await signed('addr.wsnp', 'Address', ed25519Signer(), { editAfterSigning: (m) => ((m.source as { url: string }).url = 'https://elsewhere.example/') })
    const d = await signed('date.wsnp', 'Date', ecdsaSigner(), { editAfterSigning: (m) => (m.created = '2020-01-01T00:00:00.000Z') })
    const page = await launch(a, d)
    await expect(invalid(page)).toBeVisible()
    await page.getByRole('tab', { name: /elsewhere|Address/ }).first().click()
    await expect(status(page)).toContainText('Invalid')
    await page.getByRole('tab').first().click()
    await expect(invalid(page)).toBeVisible()
  })

  test('an editor who also fixes the hash in signature.json is caught: the signature itself fails', async () => {
    const page = await launch(await signed('fixed.wsnp', 'Careful editor', ed25519Signer(), { editAfterSigning: (m) => (m.description = 'Edited'), fixHash: true }))
    await expect(invalid(page)).toBeVisible()
    await invalid(page).getByRole('button', { name: 'Show Metadata' }).click()
    await expect(metadata(page)).toContainText('The signature does not match the manifest')
  })

  test('a signature that is not the signer\'s, or that cannot be read, is not valid either', async () => {
    const a = ed25519Signer()
    const other = ed25519Signer()
    const foreign = await signed('foreign.wsnp', 'Foreign', a, { signature: { public_key: other.publicKey.toString('base64') } })
    const page = await launch(foreign)
    await expect(invalid(page)).toBeVisible()
    await app!.close()
    const damaged = await signed('damaged.wsnp', 'Damaged', a, { signature: { signature: Buffer.alloc(10).toString('base64') } })
    const again = await launch(damaged)
    await expect(invalid(again)).toBeVisible()
    await invalid(again).getByRole('button', { name: 'Show Metadata' }).click()
    await expect(metadata(again)).toContainText('The signature is damaged and cannot be read.')
  })
})
