import { find, isNullOrUndefined, isCallable, warn, values, assign } from './utils';

// @flow

export default class ErrorBag {
  items: FieldError[];

  constructor () {
    this.items = {};
    this.length = 0;
    // LOOKS LIKE THIS:
    /**
     * items: {
     *  [fieldId]: [ERRORS]
     * }
    */
  }

  [typeof Symbol === 'function' ? Symbol.iterator : '@@iterator'] () {
    let index = 0;
    let flat = this.flatten();
    return {
      next: () => {
        return { value: flat[index++], done: index > flat.length };
      }
    };
  }

  /**
   * Adds an error to the internal array.
   */
  add (error: FieldError | FieldError[]) {
    // handle old signature.
    if (arguments.length > 1) {
      if (process.env.NODE_ENV !== 'production') {
        warn('This usage of "errors.add()" is deprecated, please consult the docs for the new signature. https://baianat.github.io/vee-validate/api/errorbag.html#api');
      }

      error = {
        field: arguments[0],
        msg: arguments[1],
        rule: arguments[2],
        scope: !isNullOrUndefined(arguments[3]) ? arguments[3] : null,
        regenerate: null
      };
    }

    if (!this.items[error.id]) {
      this.items = assign({}, this.items, {
        [error.id]: []
      });
    }

    const oldLength = this.items[error.id].length;
    this.items[error.id].push(
      ...this._normalizeError(error)
    );
    const newLength = this.items[error.id].length;
    this.length += newLength - oldLength;
  }

  /**
   * Normalizes passed errors to an error array.
   */
  _normalizeError (error: FieldError | FieldError[]): FieldError[] {
    if (Array.isArray(error)) {
      return error.map(e => {
        e.scope = !isNullOrUndefined(e.scope) ? e.scope : null;

        return e;
      });
    }

    error.scope = !isNullOrUndefined(error.scope) ? error.scope : null;

    return [error];
  }

  /**
   * Regenrates error messages if they have a generator function.
   */
  regenerate (): void {
    values(this.items).forEach(errors => {
      errors.forEach(i => {
        i.msg = isCallable(i.regenerate) ? i.regenerate() : i.msg;
      });
    });
  }

  /**
   * Updates a field error with the new field scope.
   */
  update (id: string, error: FieldError) {
    const errors = this.items[id];
    if (!errors) {
      return;
    }

    errors.forEach(e => {
      e.scope = error.scope;
    });
  }

  /**
   * Gets all error messages from the internal array.
   */
  all (scope: string): Array<string> {
    if (isNullOrUndefined(scope)) {
      return this.flatten().map(e => e.msg);
    }

    return this.flatten().filter(e => e.scope === scope).map(e => e.msg);
  }

  flatten () {
    return values(this.items).reduce((flat, errors) => {
      flat.push(...errors);

      return flat;
    }, []);
  }

  /**
   * Checks if there are any errors in the internal array.
   */
  any (scope: ?string): boolean {
    if (isNullOrUndefined(scope)) {
      return !!this.length;
    }

    return !!this.flatten().filter(e => e.scope === scope).length;
  }

  /**
   * Removes all items from the internal array.
   */
  clear (scope?: ?string) {
    if (isNullOrUndefined(scope)) {
      scope = null;
    }

    values(this.items).forEach((_, idx) => {
      this.items[idx] = [];
    });
  }

  /**
   * Collects errors into groups or for a specific field.
   */
  collect (field?: string, scope?: string | null, map?: boolean = true) {
    const groupErrors = items => {
      let fieldsCount = 0;
      const errors = items.reduce((collection, error) => {
        if (!collection[error.field]) {
          collection[error.field] = [];
          fieldsCount++;
        }

        collection[error.field].push(map ? error.msg : error);

        return collection;
      }, {});

      // reduce the collection to be a single array.
      if (fieldsCount <= 1) {
        return values(errors)[0] || [];
      }

      return errors;
    };

    if (isNullOrUndefined(field)) {
      return groupErrors(this.items);
    }

    const selector = isNullOrUndefined(scope) ? String(field) : `${scope}.${field}`;
    const { isPrimary, isAlt } = this._makeCandidateFilters(selector);

    let collected = this.flatten().reduce((prev, curr) => {
      if (isPrimary(curr)) {
        prev.primary.push(curr);
      }

      if (isAlt(curr)) {
        prev.alt.push(curr);
      }

      return prev;
    }, { primary: [], alt: [] });

    collected = collected.primary.length ? collected.primary : collected.alt;

    return groupErrors(collected);
  }

  /**
   * Gets the internal array length.
   */
  count (): number {
    return this.length;
  }

  /**
   * Finds and fetches the first error message for the specified field id.
   */
  firstById (id: string): string | null {
    const error = this.items[id];

    return error ? error.msg : undefined;
  }

  /**
   * Gets the first error message for a specific field.
   */
  first (field: string, scope ?: ?string = null) {
    const selector = isNullOrUndefined(scope) ? field : `${scope}.${field}`;
    const match = this._match(selector);

    return match && match.msg;
  }

  /**
   * Returns the first error rule for the specified field
   */
  firstRule (field: string, scope ?: string): string | null {
    const errors = this.collect(field, scope, false);

    return (errors.length && errors[0].rule) || undefined;
  }

  /**
   * Checks if the internal array has at least one error for the specified field.
   */
  has (field: string, scope?: ?string = null): boolean {
    return !!this.first(field, scope);
  }

  /**
   * Gets the first error message for a specific field and a rule.
   */
  firstByRule (name: string, rule: string, scope?: string | null = null) {
    const error = this.collect(name, scope, false).filter(e => e.rule === rule)[0];

    return (error && error.msg) || undefined;
  }

  /**
   * Gets the first error message for a specific field that not match the rule.
   */
  firstNot (name: string, rule?: string = 'required', scope?: string | null = null) {
    const error = this.collect(name, scope, false).filter(e => e.rule !== rule)[0];

    return (error && error.msg) || undefined;
  }

  /**
   * Removes errors by matching against the id or ids.
   */
  removeById (id: string | string[]) {
    if (!Array.isArray(id)) {
      const removed = this.items[id].length;
      this.items[id] = [];
      this.length -= removed;

      return;
    }

    id.forEach(e => {
      this.removeById(e);
    });
  }

  /**
   * Removes all error messages associated with a specific field.
   */
  remove (field: string, scope: ?string) {
    if (isNullOrUndefined(field)) {
      return;
    }

    const selector = isNullOrUndefined(scope) ? String(field) : `${scope}.${field}`;
    const { isPrimary } = this._makeCandidateFilters(selector);

    this.flatten().forEach(item => {
      if (isPrimary(item)) {
        this.items[item.id].splice(item, 1);
        this.length--;
      }
    });
  }

  _makeCandidateFilters (selector) {
    let matchesRule = () => true;
    let matchesScope = () => true;
    let matchesName = () => true;

    let [, scope, name, rule] = selector.match(/((?:[\w-\s])+\.)?((?:[\w-.*\s])+)(:\w+)?/);
    if (rule) {
      rule = rule.replace(':', '');
      matchesRule = (item) => item.rule === rule;
    }

    // match by id, can be combined with rule selection.
    if (selector.startsWith('#')) {
      return {
        isPrimary: item => matchesRule(item) && (item => selector.slice(1).startsWith(item.id)),
        isAlt: () => false
      };
    }

    if (isNullOrUndefined(scope)) {
      // if no scope specified, make sure the found error has no scope.
      matchesScope = item => isNullOrUndefined(item.scope);
    } else {
      scope = scope.replace('.', '');
      matchesScope = item => item.scope === scope;
    }

    if (!isNullOrUndefined(name) && name !== '*') {
      matchesName = item => item.field === name;
    }

    // matches the first candidate.
    const isPrimary = (item) => {
      return matchesName(item) && matchesRule(item) && matchesScope(item);
    };

    // matches a second candidate, which is a field with a name containing the '.' character.
    const isAlt = (item) => {
      return matchesRule(item) && item.field === `${scope}.${name}`;
    };

    return {
      isPrimary,
      isAlt
    };
  }

  _match (selector: string) {
    if (isNullOrUndefined(selector)) {
      return undefined;
    }

    const { isPrimary, isAlt } = this._makeCandidateFilters(selector);

    return this.flatten().reduce((prev, item, idx, arr) => {
      const isLast = idx === arr.length - 1;
      if (prev.primary) {
        return isLast ? prev.primary : prev;
      }

      if (isPrimary(item)) {
        prev.primary = item;
      }

      if (isAlt(item)) {
        prev.alt = item;
      }

      // keep going.
      if (!isLast) {
        return prev;
      }

      return prev.primary || prev.alt;
    }, {});
  };
}
