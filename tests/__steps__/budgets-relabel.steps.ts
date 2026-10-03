import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  RelabelBudgetRow,
  RelabelRow,
  RelabelStore,
  RelabelTemplateRow,
  relabelCurrencyWithStore,
} from '../../src/domain/currencyRelabel';
import { rawToBudgetRow } from '../../src/db/budgetSql';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-relabel.feature'));

class Store implements RelabelStore {
  currency = 'USD';
  budgetRows: RelabelBudgetRow[] = [];
  async getCurrency() {
    return this.currency;
  }
  async listAccountRows(): Promise<RelabelRow[]> {
    return [];
  }
  async listTransactionRows(): Promise<RelabelRow[]> {
    return [];
  }
  async listRecurringTemplateRows(): Promise<RelabelTemplateRow[]> {
    return [];
  }
  async listBudgetRows() {
    return this.budgetRows;
  }
  async updateAccountRow() {}
  async updateTransactionRow() {}
  async updateRecurringTemplateRow() {}
  async updateBudgetRow(id: string, amount: number | null) {
    this.budgetRows.find((r) => r.id === id)!.amount = amount;
  }
  async setCurrencySetting(code: string) {
    this.currency = code;
  }
  async bumpDataRevision() {}
  async runInTransaction(fn: () => Promise<void>) {
    await fn();
  }
}

const parse = (list: string): Array<number | null> =>
  list.split(/,\s*|\s+and\s+/).map((x) => (x.trim() === 'none' ? null : Number(x)));

defineFeature(feature, (test) => {
  let store: Store;
  const given = (code: string, list: string) => {
    store = new Store();
    store.currency = code;
    store.budgetRows = parse(list).map((amount, i) => ({ id: `b${i}`, amount }));
  };
  const relabel = async (code: string) => relabelCurrencyWithStore(store, code);
  const amounts = (list: string) => expect(store.budgetRows.map((r) => r.amount)).toEqual(parse(list));

  test('SGD to JPY and back', ({ given: g, when, then }) => {
    g(/^the store's currency is "(.*)" with budgets of (.*)$/, given);
    when(/^I relabel the currency to "(.*)"$/, relabel);
    then(/^the budget amounts should be (.*)$/, amounts);
    when(/^I relabel the currency to "(.*)"$/, relabel);
    then(/^the budget amounts should be (.*)$/, amounts);
  });

  test('Same-exponent relabel leaves budgets alone', ({ given: g, when, then }) => {
    g(/^the store's currency is "(.*)" with budgets of (.*)$/, given);
    when(/^I relabel the currency to "(.*)"$/, relabel);
    then(/^the budget amounts should be (.*)$/, amounts);
  });

  test('A budget that rounds to nothing becomes no budget, never 0', ({ given: g, when, then, and }) => {
    g(/^the store's currency is "(.*)" with budgets of (.*)$/, given);
    when(/^I relabel the currency to "(.*)"$/, relabel);
    then(/^the budget amounts should be (.*)$/, amounts);
    and('no stored budget should be 0 and every row should still read back', () => {
      expect(store.budgetRows.some((r) => r.amount === 0)).toBe(false);
      for (const r of store.budgetRows) {
        const row = rawToBudgetRow({
          id: r.id,
          category_id: 'dining',
          amount: r.amount,
          start_month: '2026-10',
          end_month: null,
          created_at: 1,
        });
        expect(row.amount).toBe(r.amount);
      }
    });
  });
});
