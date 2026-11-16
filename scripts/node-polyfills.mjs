// pdf.js 6 legacy build no longer polyfills Promise.withResolvers, which
// Node 20 lacks (added in Node 22). Import this before pdfjs-dist in the
// node-side tests so they keep running on Node 20.19.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new this((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// ArrayBuffer.prototype.transfer / transferToFixedLength (Node 21+), used by
// pdf.js's worker when building content streams.
for (const name of ['transfer', 'transferToFixedLength']) {
  if (typeof ArrayBuffer.prototype[name] !== 'function') {
    Object.defineProperty(ArrayBuffer.prototype, name, {
      configurable: true,
      writable: true,
      value: function (newLength = this.byteLength) {
        const copy = new ArrayBuffer(newLength);
        new Uint8Array(copy).set(new Uint8Array(this, 0, Math.min(newLength, this.byteLength)));
        return copy;
      },
    });
  }
}
