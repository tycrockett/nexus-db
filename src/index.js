import { useEffect, useRef, useState } from "react";

const createSelector = (path) => {
  const selector = (obj) => path.reduce((acc, key) => acc?.[key], obj);
  selector.path = path;
  return selector;
};

const dataSetter = (object, selector, newValue) => {
  const path = selector.path;
  if (!path) {
    throw new Error('Selector must have a "path" property for setting.');
  }
  let current = object;
  for (let i = 0; i < path.length - 1; i++) {
    current = current[path[i]];
  }
  current[path[path.length - 1]] = newValue;
};

class ListenerTree {
  constructor() {
    this.tree = {};
  }

  add(path, callback) {
    let node = this.tree;
    for (const key of path) {
      if (!node[key]) {
        node[key] = { __listeners: [] };
      }
      node = node[key];
    }
    node.__listeners.push(callback);
  }

  remove(path, callback) {
    let node = this.tree;
    const stack = [];
    for (const key of path) {
      if (!node[key]) return; // Path doesn't exist
      stack.push([node, key]);
      node = node[key];
    }
    node.__listeners = node.__listeners.filter((cb) => cb !== callback);

    // Clean up empty nodes
    while (stack.length) {
      const [parent, key] = stack.pop();
      if (
        Object.keys(parent[key]).length === 1 &&
        parent[key].__listeners.length === 0
      ) {
        delete parent[key];
      } else {
        break;
      }
    }
  }

  notify(path) {
    const notifyCallbacks = (node) => {
      if (!node) return;
      (node.__listeners || []).forEach((cb) => cb(Date.now()));
      for (const key of Object.keys(node)) {
        if (key !== "__listeners") notifyCallbacks(node[key]);
      }
    };

    // Notify exact path
    let node = this.tree;
    for (const key of path) {
      if (!node[key]) break;
      node = node[key];
    }
    notifyCallbacks(node);

    // Notify parent paths
    let parentNode = this.tree;
    for (const key of path) {
      if (parentNode.__listeners) {
        parentNode.__listeners.forEach((cb) => cb(Date.now()));
      }
      parentNode = parentNode[key];
    }
  }

  // Notify all listeners in the entire tree
  notifyAll() {
    const traverseAndNotify = (node) => {
      if (!node) return;
      (node.__listeners || []).forEach((cb) => cb(Date.now()));
      for (const key of Object.keys(node)) {
        if (key !== "__listeners") traverseAndNotify(node[key]);
      }
    };

    traverseAndNotify(this.tree);
  }
}

export const useNexus = (initialData) => {
  const stateRef = useRef(initialData);
  const listeners = useRef(new ListenerTree());
  const state = stateRef.current;

  const [stateSetAt, setStateSetAt] = useState(Date.now());

  const setState = (valueOrFunction) => {
    if (typeof valueOrFunction === "function") {
      stateRef.current = valueOrFunction(state);
    } else {
      stateRef.current = valueOrFunction;
    }
    setStateSetAt(Date.now());
  };

  const setStateWithSelector = (selector, newValue) => {
    dataSetter(state, selector, newValue);
    listeners.current.notify(selector.path);
  };

  const addListener = (selector, callback) => {
    listeners.current.add(selector.path, callback);
    console.log(listeners);
  };

  const removeListener = (selector, callback) => {
    listeners.current.remove(selector.path, callback);
  };

  return {
    current: state,
    set: setState,
    stateSetAt,
    link: {
      setStateWithSelector,
      addListener,
      removeListener,
    },
  };
};

export const useLink = (state, path, options = {}) => {
  const { detach = false } = options;
  const selector = useRef(createSelector(path)).current;
  const [data, setState] = useState(() => selector(state.current));

  const updateListener = () => {
    if (!detach) {
      setState(selector(state.current));
    }
  };

  useEffect(() => {
    updateListener();
    state.link.addListener(selector, updateListener);
    return () => {
      state.link.removeListener(selector, updateListener);
    };
  }, []);

  useEffect(() => {
    if (!selector.initialized) {
      selector.initialized = true;
    } else {
      updateListener();
    }
  }, [state.stateSetAt]);

  const setter = (newValue) => {
    setState(newValue);
    if (!detach) {
      state.link.setStateWithSelector(selector, newValue);
    }
  };

  return {
    data,
    set: setter,
    selector,
  };
};

export const propagateLink = (state, link) => {
  const { data, selector } = link;
  state.link.setStateWithSelector(selector, data);
};

export const syncLink = (state, link) => {
  const { selector } = link;
  const newData = selector(state.current);
  link.set(newData);
};
