import { describe, expect, it } from 'vitest';
import { assertSingleRig, boneSignature, discoverCharacters, type RigSignature } from './discover.js';

const REFERENCE_BONES = ['Body', 'Hips', 'Abdomen', 'Torso', 'Neck', 'Head', 'FootL', 'FootR'];

describe('boneSignature', () => {
  it('is order-independent', () => {
    expect(boneSignature(['Body', 'Head'])).toBe(boneSignature(['Head', 'Body']));
  });
});

describe('assertSingleRig', () => {
  it('passes when every file shares one signature', () => {
    const sig = boneSignature(REFERENCE_BONES);
    const rigs: RigSignature[] = [
      { file: 'a.fbx', signature: sig },
      { file: 'b.fbx', signature: sig },
    ];
    expect(assertSingleRig(rigs)).toBe(sig);
  });

  it('fails loud on a synthetic second rig signature (RED)', () => {
    const rigs: RigSignature[] = [
      { file: 'a.fbx', signature: boneSignature(REFERENCE_BONES) },
      { file: 'rogue.fbx', signature: boneSignature([...REFERENCE_BONES, 'ExtraBone']) },
    ];
    expect(() => assertSingleRig(rigs)).toThrow(/single-rig invariant violated/i);
  });

  it('throws on an empty input rather than silently succeeding', () => {
    expect(() => assertSingleRig([])).toThrow();
  });
});

describe('discoverCharacters', () => {
  it('accepts a matching set end-to-end via an injected loader', async () => {
    const files = ['a.fbx', 'b.fbx', 'c.fbx'];
    const result = await discoverCharacters(files, async () => REFERENCE_BONES);
    expect(result.sharedSignature).toBe(boneSignature(REFERENCE_BONES));
    expect(result.files).toEqual(files);
  });

  it('rejects a mismatching set end-to-end via an injected loader', async () => {
    const files = ['a.fbx', 'rogue.fbx'];
    await expect(
      discoverCharacters(files, async (file) => (file === 'rogue.fbx' ? [...REFERENCE_BONES, 'Extra'] : REFERENCE_BONES))
    ).rejects.toThrow(/single-rig invariant violated/i);
  });
});
