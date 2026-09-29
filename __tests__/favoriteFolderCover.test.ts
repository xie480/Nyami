import {findFirstValidFavoriteCover} from '../src/utils/favoriteFolderCover';

describe('findFirstValidFavoriteCover', () => {
  it('returns the first cover from a valid favorite video', () => {
    expect(
      findFirstValidFavoriteCover([
        {attr: 2, cover: 'https://invalid.example/cover.jpg'},
        {attr: 0, cover: 'https://valid.example/cover.jpg'},
        {attr: 0, cover: 'https://later.example/cover.jpg'},
      ]),
    ).toBe('https://valid.example/cover.jpg');
  });

  it('ignores valid entries without a usable cover', () => {
    expect(
      findFirstValidFavoriteCover([
        {attr: 0, cover: ''},
        {attr: 0, cover: '   '},
      ]),
    ).toBeNull();
  });
});
