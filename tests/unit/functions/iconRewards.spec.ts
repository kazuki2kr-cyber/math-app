import {
  getEarnedWrittenIconReward,
  normalizeIconReward,
} from '../../../functions/src/iconRewards';

const reward = {
  id: 'equation-writing-master',
  name: '方程式記述マスター',
  imageUrl: '/images/reward-icons/equation-writing-master.webp',
  condition: { type: 'written_score_at_least', value: 100 },
};

describe('icon rewards', () => {
  test('valid reward config is normalized', () => {
    expect(normalizeIconReward(reward)).toEqual(reward);
  });

  test('reward is earned only when the configured score is reached', () => {
    expect(getEarnedWrittenIconReward(reward, 99)).toBeNull();
    expect(getEarnedWrittenIconReward(reward, 100)).toEqual(reward);
  });

  test('unsafe ids and external image URLs are rejected', () => {
    expect(normalizeIconReward({ ...reward, id: 'bad.id' })).toBeNull();
    expect(normalizeIconReward({ ...reward, imageUrl: 'https://example.com/icon.png' })).toBeNull();
    expect(normalizeIconReward({ ...reward, imageUrl: '/images/reward-icons/../secret.png' })).toBeNull();
  });
});
