# Key Guardian

I want to build a url shortner type for api keys.
My idea  is simple suppose user has 4 keys and it shorten the name to key1,2,3,4 and suppose user want to use key 2 . he will type the short name and acess it directly. we can have a ratelimiting as well suppose key got exposed now 100 people try to acess it we can send notifications etc or we can have a limit on amount that can be spend like i say i am giving a intern this key and he can spend max 40usd so as this limit reaches we will stop or notify even if actual key can extend that limit . we can have a 2fa for some keys like to acess those keys you have to write down key1xxxxx where xxxxx is a pass set by you.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/96b1e8ae-3b71-4a53-9a1a-a256e4f1191e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
