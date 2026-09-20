/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Combine the per-theme stylesheets an app builds into a single sheet that
 * carries every theme at once, so a page can switch theme by setting an
 * attribute instead of swapping a <link> and paying for a second request.
 *
 * The first theme in the list is emitted as-is and is what a page gets with no
 * attribute set. Every other theme is emitted after it with its selectors
 * scoped, so a scoped rule always follows the unscoped rule it overrides.
 *
 * The scope goes inside `:where()`, which contributes no specificity. A themed
 * rule therefore has exactly the specificity of the rule it overrides and wins
 * on source order alone. That matters because the skins are generated from the
 * same SCSS: every rule has a counterpart with identical specificity, including
 * the handful that are `!important`, and anything that inflated specificity
 * would have to win those by accident rather than by construction.
 *
 * Sass cannot do this in one pass. The colours live in `skin/base/_colors.scss`
 * and are configured through `@use ... with (...)`, and a module can only be
 * configured once per compilation, so the themes have to be compiled
 * separately and joined afterwards.
 */

import fs from 'fs';
import path from 'path';
import postcss from 'postcss';

/** Selectors that must not be scoped: they match the document, not the plugin. */
const UNSCOPABLE = new Set(['html', ':root', 'body']);

/**
 * Prefix every selector in `css` so it only applies inside `scope`.
 * At-rules that group other rules (`@media`, `@supports`) are descended into;
 * `@keyframes` is not, because its children are keyframe selectors rather than
 * element selectors.
 */
function scopeCss(css, scope, from) {
    const root = postcss.parse(css, { from });

    root.walkRules(rule => {
        const parent = rule.parent;
        if (parent && parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;

        rule.selectors = rule.selectors.map(selector => {
            const trimmed = selector.trim();
            if (UNSCOPABLE.has(trimmed)) return `${scope}${trimmed}`;
            return `${scope} ${trimmed}`;
        });
    });

    return root.toResult().css;
}

/**
 * @param {string} outfile where to write the combined sheet
 * @param {{ name: string, file: string }[]} themes first one is the default
 * @param {(name: string) => string} scopeOf scope selector for a non-default theme
 */
export function writeThemeBundle(outfile, themes, scopeOf) {
    const [base, ...rest] = themes;
    const parts = [
        `/* theme: ${base.name} (default) */`,
        fs.readFileSync(base.file, 'utf8'),
    ];

    for (const theme of rest) {
        const scope = scopeOf(theme.name);
        parts.push(`\n/* theme: ${theme.name}, scoped to ${scope} */`);
        parts.push(scopeCss(fs.readFileSync(theme.file, 'utf8'), scope, theme.file));
    }

    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    fs.writeFileSync(outfile, parts.join('\n'));

    return fs.statSync(outfile).size;
}
