import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseDraft } from '../src/hooks/use-draft';

test('restoring an older salon draft drops staff attribution but preserves the order', () => {
  const item = {
    itemType: 'service',
    itemId: 'legacy-service',
    name: 'Layanan uji',
    unitPrice: 25000,
    quantity: 2,
    stockTracked: false,
  };
  assert.deepEqual(parseDraft({
    items: [{ ...item, staffId: 'legacy-staff', staffName: 'Staf uji' }],
    customerId: 'legacy-customer',
    customerName: 'Pelanggan uji',
  }), {
    items: [item],
    customerId: 'legacy-customer',
    customerName: 'Pelanggan uji',
  });
});
