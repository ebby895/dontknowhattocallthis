/*
src/content_main.js
High-level orchestration for Marketplace flows.
This scaffold maps the original content.js flow into smaller functions.
Fill in implementations by referencing dist/content.js where necessary.
*/
import { SELECTORS } from './selectors.js';
import { waitForSelector, dispatchClick } from './ui_helpers.js';

export async function clickNextFlow() {
  const btn = await waitForSelector(SELECTORS.nextButton, { timeout: 7000 });
  if (!btn) throw new Error('Next button not found');
  dispatchClick(btn);
  // Optional: wait for DOM change indicating next step
  return true;
}

// Add more exported functions corresponding to each step: fillTitle, addPhotos, setPrice, publish, etc.