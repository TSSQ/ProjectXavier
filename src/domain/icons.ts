/**
 * Curated emoji sets for account and category icon pickers.
 * Pure data — no React Native imports, so it is unit-testable in Node.
 */

export const ACCOUNT_ICONS: string[] = [
  '💵', // cash
  '🏦', // bank
  '💳', // credit card
  '🏛️', // loan / institution
  '📈', // investment
  '👛', // wallet / general
  '💰', // savings / general
  '🪙', // coin
  '🐷', // piggy bank
  '💴', // foreign cash
  '🏧', // ATM
  '📊', // portfolio
  '💹', // yen / growth
  '🏠', // home equity / mortgage
  '🚗', // auto loan
  '💎', // asset / jewellery
  '✈️', // travel account
  '🌐', // multi-currency
  '🔐', // locked / secure
  '📦', // general reserve
];

/**
 * The icons a picker should display: the curated `icons` set, with `value`
 * prepended when it's a non-empty custom emoji not already in the set — so a
 * previously-typed icon stays visible and selectable. Pure so it's unit-tested.
 */
export function displayedIcons(
  icons: string[],
  value?: string | null
): string[] {
  return value && !icons.includes(value) ? [value, ...icons] : icons;
}

export const CATEGORY_ICONS: string[] = [
  '🍔', // food / restaurants
  '🛒', // groceries / shopping
  '🚗', // transport / car
  '⛽', // fuel
  '🏠', // housing / rent
  '💡', // utilities
  '📱', // phone / subscriptions
  '🎬', // entertainment
  '✈️', // travel
  '🏥', // medical
  '💊', // pharmacy / health
  '🎓', // education
  '👕', // clothing / fashion
  '🎁', // gifts
  '💪', // gym / fitness
  '🐶', // pets
  '☕', // coffee
  '🍻', // bars / drinks
  '💼', // business / work
  '💰', // savings / general
  '🧴', // personal care
  '🧹', // household / cleaning
  '📚', // books
  '🎮', // gaming
  '🍕', // dining out
  '🚌', // public transport
  '🏋️', // sports
  '🎵', // music
  '🌿', // garden / nature
  '🔧', // maintenance / repairs
  '🌐', // internet / streaming
  '🧒', // childcare / kids
  '🏖️', // holidays
  '🎪', // events / activities
  '🏪', // general shopping
  '🚑', // emergency / insurance
  '🍷', // wine / dining
  '🖥️', // tech / electronics
];
