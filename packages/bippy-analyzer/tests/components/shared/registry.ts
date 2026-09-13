interface Registry {
  register: (name: string) => string;
  getNames: () => string[];
}

const createRegistry = (): Registry => {
  let names: string[] = [];
  return {
    register: (name) => {
      names = [...names, name];
      return name;
    },
    getNames: () => names,
  };
};

class Counter {
  count = 0;

  increment(): number {
    this.count += 1;
    return this.count;
  }
}

export const { register, getNames } = createRegistry();
export const alphaName = register("alpha");
export const betaName = register("beta");

export const counter = new Counter();
export const firstTick = counter.increment();
