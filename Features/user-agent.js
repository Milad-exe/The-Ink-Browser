const os = require('os');

class UserAgent {
    static generate() {
        const platform = os.platform()
        const arch = os.arch()
        const release = os.release()
        
        let platformString = ''
        
        switch (platform) {
            case 'darwin':
                const macVersion = release.split('.').slice(0, 2).join('_')
                if (arch === 'arm64') {
                    platformString = 'Macintosh; Intel Mac OS X 10_15_7'
                } else {
                    platformString = 'Macintosh; Intel Mac OS X 10_15_7'
                }
                break
            case 'win32':
                if (arch === 'x64') {
                    platformString = 'Windows NT 10.0; Win64; x64'
                } else {
                    platformString = 'Windows NT 10.0; WOW64'
                }
                break
            case 'linux':
                if (arch === 'x64') {
                    platformString = 'X11; Linux x86_64'
                } else if (arch === 'arm64') {
                    platformString = 'X11; Linux aarch64'
                } else {
                    platformString = 'X11; Linux i686'
                }
                break
            default:
                platformString = 'X11; Linux x86_64'
        }
        
        return `Mozilla/5.0 (${platformString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36`
    }

    static getHeaders() {
        return {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
        }
    }

    static setupTabHeaders(tab) {
        tab.webContents.setUserAgent(this.generate())
        
        tab.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
            const headers = this.getHeaders()
            Object.assign(details.requestHeaders, headers)
            callback({ requestHeaders: details.requestHeaders })
        })
    }

    static getPlatformInfo() {
        return {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            type: os.type()
        }
    }
}

module.exports = UserAgent;