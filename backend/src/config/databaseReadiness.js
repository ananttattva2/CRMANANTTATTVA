// Share concurrent initial/retry attempts, but permit a later retry after failure.
function singleFlight(connect) {
  let pending;
  function ready() {
    if (!pending) {
      pending = Promise.resolve().then(connect).finally(() => { pending = undefined; });
    }
    return pending;
  }
  ready.isPending = () => Boolean(pending);
  return ready;
}
module.exports = { singleFlight };
