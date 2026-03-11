export async function mapWithConcurrency(items, limit, iteratee) {
  if (items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }));

  return results;
}
