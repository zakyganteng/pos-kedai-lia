'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { roleLabel } from '@/lib/format';
import type { BusinessLine, CurrentUser, Role, UserInput, UserPatch } from '@/lib/types';
import { useMutation } from '@/hooks/use-mutation';
import { Dialog } from './dialog';
import { WriteError } from './states';

const NAME_MAX = 160;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 72;
/** The backend accepts one or two business lines per account. */
const LINES_MAX = 2;

const ROLES: readonly Role[] = ['owner', 'admin', 'cashier'];

type UserFormDialogProps = {
  /** Null creates an account; a user edits that account. */
  user: CurrentUser | null;
  lines: BusinessLine[];
  /** True when the signed-in owner is editing their own account. */
  self: boolean;
  onClose: () => void;
  /** Called after the server confirms the write. The screen re-reads the list. */
  onSaved: () => void;
  onSessionExpired: () => void;
};

function sameLines(selected: string[], current: readonly BusinessLine[]): boolean {
  if (selected.length !== current.length) return false;
  const existing = new Set(current.map((entry) => entry.id));
  return selected.every((id) => existing.has(id));
}

/**
 * Create or edit one account.
 *
 * An edit sends only the fields that actually changed, so an untouched field
 * is never re-asserted against a value another owner may have changed in the
 * meantime. The password box is write-only: it is empty on open and leaving
 * it empty keeps the stored password.
 */
export function UserFormDialog({
  user,
  lines,
  self,
  onClose,
  onSaved,
  onSessionExpired,
}: UserFormDialogProps) {
  const creating = user === null;

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user?.role ?? 'cashier');
  const [active, setActive] = useState(user?.active ?? true);
  const [lineIds, setLineIds] = useState<string[]>(
    user === null ? [] : user.businessLines.map((entry) => entry.id),
  );

  const mutate = useMutation({ onUnauthorized: onSessionExpired });
  const key = creating ? 'user:create' : `user:edit:${user.id}`;
  const failure = mutate.failureOf(key);
  const busy = mutate.isPending(key);

  const fieldError = (field: string) =>
    failure?.fieldErrors.find((entry) => entry.field === field)?.message ?? null;

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();

  const patch: UserPatch = {};
  if (!creating && user !== null) {
    if (trimmedName !== user.name) patch.name = trimmedName;
    if (trimmedEmail !== user.email) patch.email = trimmedEmail;
    if (password !== '') patch.password = password;
    if (role !== user.role) patch.role = role;
    if (active !== user.active) patch.active = active;
    if (!sameLines(lineIds, user.businessLines)) patch.businessLineIds = lineIds;
  }
  const changedCount = Object.keys(patch).length;

  const passwordLengthOk =
    password === '' ? creating === false : password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;

  const complete =
    trimmedName !== '' &&
    trimmedEmail !== '' &&
    lineIds.length >= 1 &&
    lineIds.length <= LINES_MAX &&
    (creating ? password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX : changedCount > 0);

  const submittable = complete && passwordLengthOk && !busy;

  const toggleLine = (id: string) => {
    setLineIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : current.length >= LINES_MAX
          ? current
          : [...current, id],
    );
  };

  const submit = async () => {
    if (!submittable) return;
    const ok = await mutate.run(key, async () => {
      if (creating) {
        const body: UserInput = {
          name: trimmedName,
          email: trimmedEmail,
          password,
          role,
          active,
          businessLineIds: lineIds,
        };
        await api<CurrentUser>('/users', { method: 'POST', body: JSON.stringify(body) });
        return;
      }
      await api<CurrentUser>(`/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    });
    if (!ok) return;
    onSaved();
  };

  return (
    <Dialog
      open
      title={creating ? 'Tambah pengguna' : `Ubah akun ${user.name}`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!submittable}
            onClick={() => void submit()}
          >
            {busy ? 'Menyimpan…' : creating ? 'Buat akun' : 'Simpan perubahan'}
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="pengguna-nama">
            Nama
          </label>
          <input
            id="pengguna-nama"
            className="input"
            type="text"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            required
            aria-invalid={fieldError('name') !== null ? true : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {fieldError('name') !== null ? (
            <p className="field-error">{fieldError('name')}</p>
          ) : null}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="pengguna-email">
            Email
          </label>
          <input
            id="pengguna-email"
            className="input"
            type="email"
            value={email}
            maxLength={EMAIL_MAX}
            autoComplete="off"
            required
            aria-invalid={fieldError('email') !== null ? true : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fieldError('email') !== null ? (
            <p className="field-error">{fieldError('email')}</p>
          ) : null}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="pengguna-sandi">
            {creating ? 'Kata sandi' : 'Kata sandi baru'}
          </label>
          <input
            id="pengguna-sandi"
            className="input"
            type="password"
            value={password}
            maxLength={PASSWORD_MAX}
            autoComplete="new-password"
            required={creating}
            aria-describedby="pengguna-sandi-petunjuk"
            aria-invalid={fieldError('password') !== null ? true : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="field-hint" id="pengguna-sandi-petunjuk">
            {PASSWORD_MIN} sampai {PASSWORD_MAX} karakter.
            {creating ? '' : ' Kosongkan untuk menjaga kata sandi yang sekarang.'}
          </p>
          {password !== '' && password.length < PASSWORD_MIN ? (
            <p className="field-error">Kata sandi minimal {PASSWORD_MIN} karakter.</p>
          ) : null}
          {fieldError('password') !== null ? (
            <p className="field-error">{fieldError('password')}</p>
          ) : null}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="pengguna-peran">
            Peran
          </label>
          <select
            id="pengguna-peran"
            className="select"
            value={role}
            aria-invalid={fieldError('role') !== null ? true : undefined}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {ROLES.map((entry) => (
              <option key={entry} value={entry}>
                {roleLabel(entry)}
              </option>
            ))}
          </select>
          {fieldError('role') !== null ? (
            <p className="field-error">{fieldError('role')}</p>
          ) : null}
        </div>

        <fieldset className="field span-2" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Unit usaha</legend>
          <div className="check-list">
            {lines.map((entry) => {
              const checked = lineIds.includes(entry.id);
              return (
                <label className="check-row" key={entry.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && lineIds.length >= LINES_MAX}
                    onChange={() => toggleLine(entry.id)}
                  />
                  {entry.name}
                </label>
              );
            })}
          </div>
          <p className="field-hint">Pilih satu atau dua unit usaha.</p>
          {lineIds.length === 0 ? (
            <p className="field-error">Pilih minimal satu unit usaha.</p>
          ) : null}
          {fieldError('businessLineIds') !== null ? (
            <p className="field-error">{fieldError('businessLineIds')}</p>
          ) : null}
        </fieldset>

        <div className="field span-2">
          <label className="check-row">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Akun aktif dan dapat masuk
          </label>
          {fieldError('active') !== null ? (
            <p className="field-error">{fieldError('active')}</p>
          ) : null}
        </div>
      </form>

      {creating ? null : (
        <p className="meta">
          Menyimpan perubahan mengakhiri semua sesi akun ini: pengguna tersebut akan keluar di
          semua perangkat dan harus masuk kembali.
        </p>
      )}
      {!creating && self ? (
        <p className="field-error">
          Ini akun Anda sendiri. Setelah tersimpan, Anda juga akan keluar dan harus masuk kembali.
        </p>
      ) : null}
      {!creating && changedCount === 0 ? (
        <p className="meta">Belum ada perubahan yang perlu disimpan.</p>
      ) : null}

      {failure !== null ? (
        <>
          <WriteError
            failure={failure}
            unchangedNote={
              creating ? 'Akun baru belum dibuat.' : 'Akun ini masih seperti sebelumnya.'
            }
            onRecheck={() => {
              mutate.clear(key);
              onClose();
            }}
          />
          {failure.status === 409 ? (
            <p className="meta">
              Server menolak perubahan ini. Email mungkin sudah dipakai, atau ini pemilik aktif
              terakhir yang tidak boleh diturunkan perannya maupun dinonaktifkan.
            </p>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
