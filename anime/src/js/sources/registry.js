'use strict';

const Sources = (() => {
  const registry = new Map();
  let activeId = null;

  function register(source) {
    if (!source || !source.id) throw new Error('a source needs an id');
    registry.set(source.id, source);
    if (!activeId) activeId = source.id;
    return source;
  }

  function list() {
    return [...registry.values()].map((s) => ({
      id: s.id,
      label: s.label,
      capabilities: s.capabilities || {},
    }));
  }

  function get(id) {
    const s = registry.get(id || activeId);
    if (!s) throw new Error(`unknown source: ${id || activeId}`);
    return s;
  }

  function use(id) {
    if (!registry.has(id)) throw new Error(`unknown source: ${id}`);
    activeId = id;
    return registry.get(id);
  }

  function active() {
    return get(activeId);
  }

  function can(feature, id) {
    const s = registry.get(id || activeId);
    return Boolean(s && s.capabilities && s.capabilities[feature]);
  }

  return { register, list, get, use, active, can, get activeId() { return activeId; } };
})();

if (typeof AnimePaheSource !== 'undefined') {
  Sources.register(AnimePaheSource);
}
