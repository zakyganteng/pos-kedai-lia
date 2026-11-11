'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { rupiah } from '@/lib/format';
import type { BusinessLine, QueueEntry, SalonService } from '@/lib/types';
import type { MutationResult } from '@/hooks/use-mutation';
import { buildQuery } from '@/hooks/use-paged';
import { CustomerPicker } from './customer-picker';
import { Dialog } from './dialog';
import { EmptyBlock, LoadingBlock, WriteError } from './states';

const NOTE_MAX = 300;
/** The backend refuses fewer than 1 or more than 20 services per entry. */
const SERVICES_MAX = 20;

type Draft = {
  /** The submission this draft belongs to. */
  key: string;
  serviceIds: string[];
  customer: { id: string; name: string } | null;
  note: string;
};

function emptyDraft(key: string): Draft {
  return { key, serviceIds: [], customer: null, note: '' };
}

export type QueueAddDialogProps = {
  open: boolean;
  line: BusinessLine;
  /**
   * X-Idempotency-Key for this one submission. The screen mints it when the
   * dialog opens and keeps it across retries, so a lost response cannot turn
   * one walk-in into two queue numbers.
   */
  idempotencyKey: string;
  /** Every service of the line; archived ones are filtered out here. */
  services: SalonService[];
  servicesLoading: boolean;
  /** Business date currently shown; a new entry always lands on today. */
  viewingDate: string;
  todayDate: string;
  mutate: MutationResult;
  onCreated: (entry: QueueEntry) => void;
  onClose: () => void;
  onSessionExpired: () => void;
};

/**
 * Add a walk-in to the queue: services, an optional customer and a note.
 * The queue number itself is allocated by the backend
 * for the current business date.
 */
export function QueueAddDialog({
  open,
  line,
  idempotencyKey,
  services,
  servicesLoading,
  viewingDate,
  todayDate,
  mutate,
  onCreated,
  onClose,
  onSessionExpired,
}: QueueAddDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(idempotencyKey));
  const [pickerOpen, setPickerOpen] = useState(false);

  // The idempotency key identifies one submission, so a new key *is* a new
  // form. Deriving that here rather than resetting in an effect keeps the
  // fresh fields and the fresh key in the same render.
  const { serviceIds, customer, note } =
    draft.key === idempotencyKey ? draft : emptyDraft(idempotencyKey);
  const update = (patch: Partial<Omit<Draft, 'key'>>) =>
    setDraft({ key: idempotencyKey, serviceIds, customer, note, ...patch });

  const activeServices = services.filter((service) => service.active);
  const failure = mutate.failureOf('create');
  const busy = mutate.isPending('create');

  const chosen = activeServices.filter((service) => serviceIds.includes(service.id));
  const estimate = chosen.reduce((sum, service) => sum + service.price, 0);
  const tooMany = serviceIds.length > SERVICES_MAX;

  const toggle = (id: string) => {
    update({
      serviceIds: serviceIds.includes(id)
        ? serviceIds.filter((entry) => entry !== id)
        : [...serviceIds, id],
    });
  };

  const submit = async () => {
    if (serviceIds.length === 0 || tooMany) return;
    const body: Record<string, unknown> = { serviceIds };
    if (customer !== null) body.customerId = customer.id;
    const trimmedNote = note.trim();
    if (trimmedNote !== '') body.note = trimmedNote;

    // Held on an object so the value survives the callback boundary with its
    // type intact; `mutate.run` only reports success or failure.
    const result: { entry: QueueEntry | null } = { entry: null };
    const ok = await mutate.run('create', async () => {
      result.entry = await api<QueueEntry>(
        `/salon/queue${buildQuery({ businessLineId: line.id })}`,
        {
          method: 'POST',
          headers: { 'X-Idempotency-Key': idempotencyKey },
          body: JSON.stringify(body),
        },
      );
    });
    if (!ok || result.entry === null) return;
    onCreated(result.entry);
  };

  return (
    <>
      <Dialog
        open={open && !pickerOpen}
        title="Tambah antrean"
        description="Pilih layanan yang diminta. Nomor antrean diberikan oleh server untuk tanggal bisnis hari ini."
        onClose={busy ? undefined : onClose}
        footer={
          <>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
              Batal
            </button>
            <button
              type="submit"
              form="antrean-form-tambah"
              className="btn btn-primary"
              disabled={busy || serviceIds.length === 0 || tooMany}
            >
              {busy ? 'Menyimpan…' : 'Tambah ke antrean'}
            </button>
          </>
        }
      >
        {viewingDate !== todayDate ? (
          <p className="field-hint">
            Daftar sedang menampilkan tanggal lain. Antrean baru tetap masuk ke tanggal hari ini,
            dan tampilan akan berpindah ke hari ini setelah tersimpan.
          </p>
        ) : null}

        <form
          id="antrean-form-tambah"
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="field">
            <legend className="field-label">Layanan</legend>
            {servicesLoading ? <LoadingBlock label="Memuat layanan…" /> : null}
            {!servicesLoading && activeServices.length === 0 ? (
              <EmptyBlock title="Belum ada layanan aktif pada unit usaha ini.">
                <p className="meta">
                  Tambahkan layanan lebih dulu sebelum membuka antrean.
                </p>
              </EmptyBlock>
            ) : null}
            {activeServices.length > 0 ? (
              <div className="check-list">
                {activeServices.map((service) => (
                  <label className="check-row" key={service.id}>
                    <input
                      type="checkbox"
                      checked={serviceIds.includes(service.id)}
                      onChange={() => toggle(service.id)}
                    />
                    <span>{service.name}</span>
                    <span className="meta money queue-service-price">{rupiah(service.price)}</span>
                  </label>
                ))}
              </div>
            ) : null}
            <p className="field-hint" role="status">
              {serviceIds.length === 0
                ? 'Pilih sedikitnya satu layanan.'
                : `${serviceIds.length} layanan dipilih · perkiraan ${rupiah(estimate)}`}
            </p>
            {tooMany ? (
              <p className="field-error">Maksimal {SERVICES_MAX} layanan untuk satu antrean.</p>
            ) : null}
          </fieldset>

          <div className="field">
            <span className="field-label" id="antrean-tambah-pelanggan-label">
              Pelanggan (opsional)
            </span>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary"
                aria-describedby="antrean-tambah-pelanggan-label"
                onClick={() => setPickerOpen(true)}
              >
                {customer === null ? 'Pilih pelanggan' : `Ganti: ${customer.name}`}
              </button>
              {customer !== null ? (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => update({ customer: null })}
                >
                  Hapus pilihan
                </button>
              ) : null}
            </div>
            <p className="field-hint">
              {customer === null ? 'Tanpa pelanggan' : `Terpilih: ${customer.name}`}
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="antrean-tambah-catatan">
              Catatan (opsional)
            </label>
            <textarea
              id="antrean-tambah-catatan"
              className="textarea"
              maxLength={NOTE_MAX}
              value={note}
              onChange={(event) => update({ note: event.target.value })}
            />
            <p className="field-hint">
              {note.length} dari {NOTE_MAX} karakter.
            </p>
          </div>
        </form>

        {failure !== null ? (
          <>
            {failure.fieldErrors.length > 0 ? (
              <ul className="field-error">
                {failure.fieldErrors.map((entry) => (
                  <li key={`${entry.field}:${entry.message}`}>
                    {entry.field}: {entry.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <WriteError
              failure={failure}
              unchangedNote="Antrean baru belum dibuat."
              onRecheck={() => {
                // The same key is kept, so pressing Tambah again replays the
                // original request instead of creating a second entry.
                mutate.clear('create');
                onClose();
              }}
            />
          </>
        ) : null}
      </Dialog>

      <CustomerPicker
        open={pickerOpen}
        lineId={line.id}
        selectedId={customer?.id ?? null}
        onPick={(customerId, customerName) =>
          update({
            customer:
              customerId === null || customerName === null
                ? null
                : { id: customerId, name: customerName },
          })
        }
        onClose={() => setPickerOpen(false)}
        onSessionExpired={onSessionExpired}
      />
    </>
  );
}
