import {
  BoundNames,
  IsConstantDeclaration,
  LexicallyDeclaredNames,
  LexicallyScopedDeclarations,
  VarDeclaredNames,
  VarScopedDeclarations,
} from '../static-semantics/all.mts';
import { Q, NormalCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { InstantiateFunctionObject } from './all.mts';
import { Assert, GlobalEnvironmentRecord, Throw } from '#self';

export function* GlobalDeclarationInstantiation(script: ParseNode.Script, env: GlobalEnvironmentRecord) {
  // 2. Let lexNames be the LexicallyDeclaredNames of script.
  const lexNames = LexicallyDeclaredNames(script);
  // 3. Let varNames be the VarDeclaredNames of script.
  const varNames = VarDeclaredNames(script);
  // 4. For each name in lexNames, do
  for (const name of lexNames) {
    // 1. If env.HasLexicalDeclaration(name) is true, throw a SyntaxError exception.
    if (yield* env.HasLexicalDeclaration(name)) {
      return Throw.SyntaxError('$1 is already declared', name);
    }
    // 1. Let hasRestrictedGlobal be ? env.HasRestrictedGlobalProperty(name).
    const hasRestrictedGlobal = Q(yield* env.HasRestrictedGlobalProperty(name));
    // 1. If hasRestrictedGlobal is true, throw a SyntaxError exception.
    if (hasRestrictedGlobal) {
      return Throw.SyntaxError('$1 is already declared', name);
    }
  }
  // 5. For each name in varNames, do
  for (const name of varNames) {
    // 1. If env.HasLexicalDeclaration(name) is true, throw a SyntaxError exception.
    if (yield* env.HasLexicalDeclaration(name)) {
      return Throw.SyntaxError('$1 is already declared', name);
    }
  }
  // 6. Let varDeclarations be the VarScopedDeclarations of script.
  const varDeclarations = VarScopedDeclarations(script);
  // 7. Let functionsToInitialize be a new empty List.
  const functionsToInitialize = [];
  // 8. Let declaredFunctionNames be a new empty List.
  const declaredFunctionNames = new Set<string>();
  // 9. For each d in varDeclarations, in reverse list order, do
  for (const d of [...varDeclarations].reverse()) {
    // a. If d is neither a VariableDeclaration nor a ForBinding nor a BindingIdentifier, then
    if (d.type !== 'VariableDeclaration'
        && d.type !== 'ForBinding'
        && d.type !== 'BindingIdentifier') {
      // i. Assert: d is either a FunctionDeclaration, a GeneratorDeclaration, an AsyncFunctionDeclaration, or an AsyncGeneratorDeclaration.
      Assert(d.type === 'FunctionDeclaration'
             || d.type === 'GeneratorDeclaration'
             || d.type === 'AsyncFunctionDeclaration'
             || d.type === 'AsyncGeneratorDeclaration');
      // ii. NOTE: If there are multiple function declarations for the same name, the last declaration is used.
      // iii. Let fn be the sole element of the BoundNames of d.
      const fn = BoundNames(d)[0];
      // iv. If fn is not an element of declaredFunctionNames, then
      if (!declaredFunctionNames.has(fn)) {
        // 1. Let fnDefinable be ? env.CanDeclareGlobalFunction(fn).
        const fnDefinable = Q(yield* env.CanDeclareGlobalFunction(fn));
        // 2. If fnDefinable is false, throw a TypeError exception.
        if (!fnDefinable) {
          return Throw.TypeError('$1 is already declared', fn);
        }
        // 3. Append fn to declaredFunctionNames.
        declaredFunctionNames.add(fn);
        // 4. Insert d as the first element of functionsToInitialize.
        functionsToInitialize.unshift(d);
      }
    }
  }
  // 10. Let declaredVarNames be a new empty List.
  const declaredVarNames = new Set<string>();
  // 11. For each d in varDeclarations, do
  for (const d of varDeclarations) {
    // a. If d is a VariableDeclaration, a ForBinding, or a BindingIdentifier, then
    if (d.type === 'VariableDeclaration'
        || d.type === 'ForBinding'
        || d.type === 'BindingIdentifier') {
      // i. For each String vn in the BoundNames of d, do
      for (const vn of BoundNames(d)) {
        // 1. If vn is not an element of declaredFunctionNames, then
        if (!declaredFunctionNames.has(vn)) {
          // a. Let vnDefinable be ? env.CanDeclareGlobalVar(vn).
          const vnDefinable = Q(yield* env.CanDeclareGlobalVar(vn));
          // b. If vnDefinable is false, throw a TypeError exception.
          if (!vnDefinable) {
            return Throw.TypeError('$1 is already declared', vn);
          }
          // c. If vn is not an element of declaredVarNames, then
          if (!declaredVarNames.has(vn)) {
            // i. Append vn to declaredVarNames.
            declaredVarNames.add(vn);
          }
        }
      }
    }
  }
  // 12. NOTE: No abnormal terminations occur after this algorithm step if the global object is an ordinary object. However, if the global object is a Proxy exotic object it may exhibit behaviours that cause abnormal terminations in some of the following steps.
  // 13. NOTE: Annex B.3.3.2 adds additional steps at this point.
  // 14. Let lexDeclarations be the LexicallyScopedDeclarations of script.
  const lexDeclarations = LexicallyScopedDeclarations(script);
  // 15. Let privateEnv be null.
  const privateEnv = null;
  // 16. For each element d in lexDeclarations, do
  for (const d of lexDeclarations) {
    // a. NOTE: Lexically declared names are only instantiated here but not initialized.
    // b. For each element dn of the BoundNames of d, do
    for (const dn of BoundNames(d)) {
      // 1. If IsConstantDeclaration of d is true, then
      if (IsConstantDeclaration(d)) {
        // 1. Perform ? env.CreateImmutableBinding(dn, true).
        Q(env.CreateImmutableBinding(dn, true));
      } else { // 1. Else,
        // 1. Perform ? env.CreateMutableBinding(dn, false).
        Q(yield* env.CreateMutableBinding(dn, false));
      }
    }
  }
  // 17. For each Parse Node f in functionsToInitialize, do
  for (const f of functionsToInitialize) {
    // a. Let fn be the sole element of the BoundNames of f.
    const fn = BoundNames(f)[0];
    // b. Let fo be InstantiateFunctionObject of f with argument env and privateEnv.
    const fo = InstantiateFunctionObject(f, env, privateEnv);
    // c. Perform ? env.CreateGlobalFunctionBinding(fn, fo, false).
    Q(yield* env.CreateGlobalFunctionBinding(fn, fo, false));
  }
  // 18. For each String vn in declaredVarNames, in list order, do
  for (const vn of declaredVarNames) {
    // a. Perform ? env.CreateGlobalVarBinding(vn, false).
    Q(yield* env.CreateGlobalVarBinding(vn, false));
  }
  // 19. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}
