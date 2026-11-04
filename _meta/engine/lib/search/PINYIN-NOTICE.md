# Pinyin table notice

`pinyin.mjs` contains a pinyin conversion table and a binary-search algorithm adapted from:

- **tiny-pinyin** 1.3.2 — https://github.com/creeperyang/pinyin (MIT License).
  Copyright (c) 2016 creeperyang.
- The character table in tiny-pinyin credits
  **Android ContactsProvider HanziToPinyin** (Apache License 2.0):
  https://android.googlesource.com/platform/packages/providers/ContactsProvider/+/0c49720fb3d58e346739c2ccd56ed2b739249e07/src/com/android/providers/contacts/HanziToPinyin.java

The data is vendored as source code so `@local/kb-engine` keeps its
zero-runtime-dependency contract. It is used only as a best-effort fallback for
full-text search (full pinyin and initials); it is not a general-purpose
transliteration service and has no polyphone disambiguation.

tiny-pinyin MIT license text:

```
MIT License

Copyright (c) 2016 creeperyang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
