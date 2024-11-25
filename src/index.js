import { useCallback, useEffect, useRef, useState } from "react";
import * as uuid from "uuid";

const createSelector = (link) => {
  const selector = (obj) => {
    return link.reduce((acc, key) => acc?.[key], obj);
  };
  selector.id = uuid.v4();
  selector.link = link;
  return selector;
};

const dataSetter = (object, selector, newValue) => {
  const link = selector.link;
  if (!link) {
    throw new Error('Selector must have a "link" property for setting.');
  }
  let current = object;
  for (let i = 0; i < link.length - 1; i++) {
    current = current[link[i]];
  }
  current[link[link.length - 1]] = newValue;
};

const flattenObject = (obj, parentKey = "", separator = ".") => {
  let result = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const fullKey = parentKey ? `${parentKey}${separator}${key}` : key;
      if (
        typeof obj[key] === "object" &&
        obj[key] !== null &&
        !Array.isArray(obj[key])
      ) {
        Object.assign(result, flattenObject(obj[key], fullKey, separator));
      } else {
        result[fullKey] = obj[key];
      }
    }
  }

  return result;
};
class ListenerTree {
  constructor() {
    this.tree = {};
  }

  add(link, callback) {
    let node = this.tree;
    for (const key of link) {
      if (!node[key]) {
        node[key] = { __listeners: [] };
      }
      node = node[key];
    }
    node.__listeners.push(callback);
  }

  remove(link, callback) {
    let node = this.tree;
    const stack = [];
    for (const key of link) {
      if (!node[key]) return; // link doesn't exist
      stack.push([node, key]);
      node = node[key];
    }
    node.__listeners = node.__listeners?.filter((cb) => cb !== callback);

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

  notify(link) {
    const notifyCallbacks = (node) => {
      if (!node) return;
      (node.__listeners || []).forEach((cb) => cb(Date.now()));
      for (const key of Object.keys(node)) {
        if (key !== "__listeners") notifyCallbacks(node[key]);
      }
    };

    // Notify exact link
    let node = this.tree;
    for (const key of link) {
      if (!node[key]) break;
      node = node[key];
    }
    notifyCallbacks(node);

    // Notify parent links
    let parentNode = this.tree;
    for (const key of link) {
      if (parentNode.__listeners) {
        parentNode.__listeners.forEach((cb) => cb(Date.now()));
      }
      parentNode = parentNode[key];
    }
  }

  notifyAll() {
    const traverseAndNotify = (node) => {
      if (!node || typeof node !== "object") return;

      // Notify listeners
      if (Array.isArray(node.__listeners)) {
        node.__listeners.forEach((cb) => {
          if (typeof cb === "function") {
            try {
              cb(Date.now());
            } catch (err) {
              console.error("Callback error:", err);
            }
          }
        });
      }

      // Traverse child nodes
      for (const key of Object.keys(node)) {
        if (key !== "__listeners" && typeof node[key] === "object") {
          traverseAndNotify(node[key]);
        }
      }
    };

    traverseAndNotify(this.tree);
  }
}

export const useNexus = (initialData, options = {}) => {
  const { flatten = true } = options;
  const stateRef = useRef(() => flattenObject(initialData));
  const listeners = useRef(new ListenerTree());
  const state = stateRef.current;

  const [nexusUpdateAt, setNexusUpdateAt] = useState(null);

  const setState = (valueOrFunction) => {
    let next = {};
    if (typeof valueOrFunction === "function") {
      next = valueOrFunction(state);
    } else {
      next = valueOrFunction;
    }
    if (flatten) {
      next = flattenObject(next);
    }
    stateRef.current = next;
    setNexusUpdateAt(Date.now());
  };

  const setNexusWithSelector = (selector, newValue) => {
    dataSetter(state, selector, newValue);
    listeners.current.notify(selector.link);
  };

  const addListener = (selector, callback) => {
    listeners.current.add(selector.link, callback);
  };

  const removeListener = (selector, callback) => {
    listeners.current.remove(selector.link, callback);
  };

  return {
    current: state,
    set: setState,
    link: {
      setNexusWithSelector,
      addListener,
      removeListener,
      nexusUpdateAt,
      logListeners: () => console.log(listeners.current),
    },
  };
};

export const useLink = (state, options = {}) => {
  const {
    link = [],
    initialData = null,
    subscribed = true,
    muted = false,
  } = options;
  const selector = useRef(createSelector(link)).current;
  const [data, setData] = useState(
    () => selector(state.current) || initialData
  );
  const [linkKey, setLinkKey] = useState(selector.id);

  const updateLinkKey = () => {
    const time = Date.now();
    const key = `${selector.id}-${time}`;
    setLinkKey(key);
  };

  const setter = useCallback(
    (newValue) => {
      setData(newValue);
      if (!muted) {
        state.link.setNexusWithSelector(selector, newValue);
      }
    },
    [state.current, selector, muted]
  );

  const updateLinkFromNexus = useCallback(() => {
    if (subscribed) {
      const newData = () => selector(state.current);
      setData(newData);
    }
  }, [subscribed, selector, state.current]);

  useEffect(() => {
    state.link.removeListener(selector, updateLinkFromNexus);
    if (subscribed) {
      state.link.addListener(selector, updateLinkFromNexus);
    }
    return () => {
      state.link.removeListener(selector, updateLinkFromNexus);
    };
  }, [subscribed, updateLinkFromNexus]);

  const updateSelector = () => {
    selector.current = createSelector(link);
    updateLinkKey();
  };

  useEffect(() => {
    updateSelector();
    updateLinkFromNexus();
  }, [state?.link?.nexusUpdateAt]);

  return {
    data,
    set: setter,
    setData,
    metadata: {
      updateKey: updateLinkKey,
      key: linkKey,
      selector,
    },
  };
};

export const propagateLink = (state, link) => {
  const { data, metadata } = link;
  state.link.setNexusWithSelector(metadata?.selector, data);
};

export const syncLink = (state, link) => {
  const { set, metadata } = link;
  const newData = metadata?.selector(state.current);
  set(newData);
};
