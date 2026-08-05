module.exports = [
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals: {
                require: "readonly",
                module: "readonly",
                __dirname: "readonly",
                process: "readonly",
                console: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                window: "readonly",
                document: "readonly",
                io: "readonly",
                Image: "readonly",
                requestAnimationFrame: "readonly",
                fetch: "readonly",
                Worker: "readonly",
                localStorage: "readonly",
                sessionStorage: "readonly",
                AudioContext: "readonly",
                webkitAudioContext: "readonly",
                Audio: "readonly",
                SpeechSynthesisUtterance: "readonly",
                URLSearchParams: "readonly",
                speechSynthesis: "readonly",
                getComputedStyle: "readonly",
                self: "readonly",
                postMessage: "readonly",
                onmessage: "readonly",
                onerror: "readonly",
                caches: "readonly",
                navigator: "readonly",
                HTMLElement: "readonly",
                HTMLCanvasElement: "readonly",
                performance: "readonly",
                matchMedia: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "no-undef": "error",
            "no-extra-semi": "error"
        }
    },
    {
        files: ["workers/**/*.js"],
        languageOptions: {
            globals: {
                self: "readonly",
                postMessage: "readonly",
                onmessage: "readonly"
            }
        }
    }
];
