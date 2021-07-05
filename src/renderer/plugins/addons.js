import fs from 'fs'
import path from 'path'
import https from 'https'

import unzipper from 'unzipper'
import sha256File from 'sha256-file'
import Vue from 'vue'

const isDev = process.env.NODE_ENV === 'development'

class Addons {
  constructor (ctx) {
    this.AUTO_DOWNLOADED = {
      classic: {
        url: 'https://jcloisterzone.com/artworks/classic/classic-4-5.7.0.zip',
        version: '4 (5.7.0)',
        sha256: '0adf770db8b12d33b76c63fd1bc9c130b83474cffc2b770c2f27dd2a160e1ef8',
        size: 88733423
      }
    }

    this.ctx = ctx
    this.addons = []
    this.artworks = []
    this.expansions = []
  }

  async loadAddons () {
    console.log('Looking for installed addons')
    const { settings } = this.ctx.store.state
    const userDataPath = window.process.argv.find(arg => arg.startsWith('--user-data=')).replace('--user-data=', '')

    // clean up 5.6 data
    let oldArtworkDir
    try {
      oldArtworkDir = await fs.promises.stat(path.join(userDataPath, 'artworks'))
    } catch (e) {}
    if (oldArtworkDir?.isDirectory()) {
      try {
        await fs.promises.rmdir(path.join(userDataPath, 'artworks'), { recursive: true })
      } catch (e) {
        console.error('Unable to remove old artwork folder', e)
      }
    }

    const lookupFolders = [
      path.join(userDataPath, 'addons')
      // process.resourcesPath + '/addons/'
    ]

    const installedAddons = []
    const installedAddonsIds = new Set()

    for (const fullPath of settings.userAddons) {
      const addon = await this._readAddon(path.basename(fullPath), fullPath)
      if (addon && !installedAddonsIds.has(addon.id)) {
        installedAddons.push(addon)
        installedAddonsIds.add(addon.id)
      }
    }

    for (const lookupFolder of lookupFolders) {
      let listing
      try {
        listing = await fs.promises.readdir(lookupFolder)
      } catch (e) {
        console.log(`${lookupFolder} does not exist`)
        continue
      }
      for (const id of listing) {
        // when same artwork is on path twice, register first found
        // this allowes overide from user path
        if (!installedAddonsIds.has(id)) {
          const fullPath = path.join(lookupFolder, id)
          const addon = await this._readAddon(id, fullPath)
          if (addon) {
            installedAddons.push(addon)
            installedAddonsIds.add(id)
          }
        }
      }
    }

    await this.updateOutdated(installedAddons)

    console.log('Installed addons: ', installedAddons)

    const installedArtworks = []
    const installedExpansions = []

    for (const addon of installedAddons) {
      for (const relPath of (addon.json.artworks || [])) {
        const fullPath = path.join(addon.folder, relPath)
        const artwork = await this._readArtwork(addon.id + '/' + path.basename(fullPath), fullPath)
        installedArtworks.push(artwork)
      }

      for (const relPath of (addon.json.expansions || [])) {
        const fullPath = path.join(addon.folder, relPath)
        installedExpansions.push(fullPath)
      }
    }

    this.addons = installedAddons
    this.artworks = installedArtworks
    this.expansions = installedExpansions

    this.ctx.app.store.commit('addonsLoaded')
  }

  async updateOutdated (installedAddons) {
    const classicArtwork = installedAddons.find(({ id }) => id === 'classic')
    if (classicArtwork && !classicArtwork.outdated) return

    console.log('Downloading classic artwork.')
    const link = this.AUTO_DOWNLOADED.classic.url
    this.ctx.app.store.commit('download', {
      name: 'classic.zip',
      description: 'Downloading classic artwork',
      progress: null,
      size: null,
      link
    })

    const userDataPath = window.process.argv.find(arg => arg.startsWith('--user-data=')).replace('--user-data=', '')
    const addonsFolder = path.join(userDataPath, 'addons')
    await fs.promises.mkdir(addonsFolder, { recursive: true })
    const zipName = path.join(addonsFolder, 'classic.zip')
    try {
      if ((await fs.promises.stat(zipName)).isFile()) {
        await fs.promises.unlink(zipName)
      }
    } catch {
      // ignore
    }
    const file = fs.createWriteStream(zipName)
    await new Promise((resolve, reject) => {
      let downloadedBytes = 0
      https.get(link, response => {
        const total = parseInt(response.headers['content-length'])
        this.ctx.app.store.commit('downloadSize', total)
        response.on('data', chunk => {
          downloadedBytes += chunk.length
          this.ctx.app.store.commit('downloadProgress', downloadedBytes)
        })
        response.pipe(file)

        file.on('finish', function () {
          file.close(resolve)
        })
      }).on('error', function (err) { // Handle errors
        fs.unlink(zipName) // Delete the file async. (But we don't check the result)
        reject(err.message)
      })
    })
    const checksum = sha256File(zipName)
    if (checksum !== this.AUTO_DOWNLOADED.classic.sha256) {
      console.log('classic.zip checksum mismatch ' + checksum)
      this.ctx.app.store.commit('download', {
        name: 'classic.zip',
        description: 'Error: Downloaded file has invalid checksum',
        progress: 0,
        size: this.AUTO_DOWNLOADED.classic.size,
        link
      })
      await fs.promises.unlink(zipName)
    } else {
      console.log('classic.zip downloaded. sha256: ' + checksum)
      if (classicArtwork?.outdated) {
        console.log('Removing outdated artwork ' + classicArtwork.folder)
        await fs.promises.rmdir(classicArtwork.folder, { recursive: true })
      }
      await fs.createReadStream(zipName)
        .pipe(unzipper.Extract({ path: addonsFolder }))
        .promise()
      await fs.promises.unlink(zipName)
      this.ctx.app.store.commit('download', null)
    }

    const fullPath = path.join(addonsFolder, 'classic')
    const artwork = await this._readAddon('classic', fullPath)
    if (classicArtwork) {
      Object.assign(classicArtwork, artwork)
    } else {
      installedAddons.unshift(artwork)
    }
  }

  async _readAddon (id, fullPath) {
    const stats = await fs.promises.stat(fullPath)
    if (stats.isDirectory()) {
      const jsonPath = path.join(fullPath, 'jcz-addon.json')
      let json
      try {
        json = JSON.parse(await fs.promises.readFile(jsonPath))
      } catch (e) {
        // not plugin folder, do nothing
        return null
      }
      try {
        json.id = id
        const addon = {
          id,
          folder: fullPath,
          json,
          remote: this.AUTO_DOWNLOADED[id] || null
        }
        if (addon.remote) {
          if (addon.json.version !== addon.remote.version) {
            // temporary migration to new version scheme
            const currentVersion = ~~addon.json.version.split(' ')[0]
            const requiredVersion = ~~addon.remote.version.split(' ')[0]
            if (currentVersion < requiredVersion) {
              console.log(`Artwork ${id} is outdated (current ${currentVersion}, reqired ${requiredVersion})`)
              addon.outdated = true
            }
          }
        }

        return addon
      } catch (e) {
        // unexpected error
        console.error(e)
      }
    }
    return null
  }

  async _readArtwork (id, fullPath) {
    const stats = await fs.promises.stat(fullPath)
    if (stats.isDirectory()) {
      const jsonPath = path.join(fullPath, 'artwork.json')
      let json
      try {
        json = JSON.parse(await fs.promises.readFile(jsonPath))
      } catch (e) {
        // not plugin folder, do nothing
        return null
      }
      try {
        json.id = id
        if (json.icon) {
          json.icon = path.join(fullPath, json.icon)
          if (isDev) {
            json.icon = 'file://' + json.icon
          }
        }
        const artwork = {
          id,
          folder: fullPath,
          json
        }
        return artwork
      } catch (e) {
        // unexpected error
        console.error(e)
      }
    }
    return null
  }
}

export default (ctx, inject) => {
  let instance = null
  const prop = {
    get () {
      if (instance === null) {
        instance = new Addons(ctx)
      }
      return instance
    }
  }

  Object.defineProperty(Vue.prototype, '$addons', prop)
  Object.defineProperty(ctx, '$addons', prop)
}
