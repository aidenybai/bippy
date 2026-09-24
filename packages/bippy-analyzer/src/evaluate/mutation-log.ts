interface MutationRecord {
  changeCount: number;
  allocation: number;
}

/**
 * Observable changes (state commits, heap and binding writes) so far, each
 * dated by the allocation ordinal of what it wrote. An activation began at
 * some allocation ordinal; writes to anything allocated later are its own and
 * reach a deeper activation only through the receiver and arguments, so
 * `oldestMutationSince` tells whether it also wrote something that predates it.
 */
export class MutationLog {
  /** Records whose allocation is below every later record's, in `changeCount` order. */
  private readonly suffixMinima: MutationRecord[] = [];
  changeCount = 0;

  record(allocation: number): void {
    this.changeCount++;
    while (
      this.suffixMinima.length > 0 &&
      this.suffixMinima[this.suffixMinima.length - 1].allocation >= allocation
    ) {
      this.suffixMinima.pop();
    }
    this.suffixMinima.push({ changeCount: this.changeCount, allocation });
  }

  /** The smallest allocation ordinal written after `changeCount`; `Infinity` when nothing was. */
  oldestMutationSince(changeCount: number): number {
    let low = 0;
    let high = this.suffixMinima.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.suffixMinima[middle].changeCount > changeCount) high = middle;
      else low = middle + 1;
    }
    return low < this.suffixMinima.length ? this.suffixMinima[low].allocation : Infinity;
  }
}
