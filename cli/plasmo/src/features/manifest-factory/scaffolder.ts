import { existsSync } from "fs"
import { copy, ensureDir } from "fs-extra"
import { readFile, writeFile } from "fs/promises"
import { ParsedPath, join, relative, resolve } from "path"

import { vLog } from "@plasmo/utils"

import { toPosix } from "~features/helpers/path"

import type { BaseFactory } from "./base"
import { isSupportedUiExt } from "./ui-library"

type ExtensionUIPage = "popup" | "options" | "devtools" | "newtab"

export class Scaffolder {
  #scaffoldCache = {} as Record<string, string>

  get projectPath() {
    return this.plasmoManifest.projectPath
  }

  get commonPath() {
    return this.plasmoManifest.commonPath
  }

  get mountExt() {
    return this.plasmoManifest.mountExt
  }

  constructor(private plasmoManifest: BaseFactory) {}

  async init() {
    const [_, ...uiPagesResult] = await Promise.all([
      this.#copyStaticCommon(),
      this.#initUiPageTemplate("popup"),
      this.#initUiPageTemplate("options"),
      this.#initUiPageTemplate("newtab"),
      this.#initUiPageTemplate("devtools")
    ])

    return uiPagesResult
  }

  #copyStaticCommon = async () => {
    const templateCommonDirectory = resolve(
      this.plasmoManifest.templatePath.staticTemplatePath,
      "common"
    )

    const staticCommonDirectory = resolve(
      this.commonPath.staticDirectory,
      "common"
    )

    return copy(templateCommonDirectory, staticCommonDirectory)
  }

  #initUiPageTemplate = async (uiPageName: ExtensionUIPage) => {
    vLog(`Creating static templates for ${uiPageName}`)

    const indexList = this.projectPath[`${uiPageName}IndexList`]
    const htmlList = this.projectPath[`${uiPageName}HtmlList`]

    const indexFile = indexList.find(existsSync)
    const htmlFile = htmlList.find(existsSync)

    const { staticDirectory } = this.commonPath

    // Generate the static diretory
    await ensureDir(staticDirectory)

    const hasIndex = indexFile !== undefined

    // console.log({ indexFile, hasIndex })

    const indexImport = hasIndex
      ? toPosix(relative(staticDirectory, indexFile))
      : `~${uiPageName}`

    const uiPageModulePath = resolve(
      staticDirectory,
      `${uiPageName}${this.mountExt}`
    )

    await Promise.all([
      this.#cachedGenerate(`index${this.mountExt}`, uiPageModulePath, {
        __plasmo_import_module__: indexImport
      }),
      this.createPageHtml(uiPageName, htmlFile)
    ])

    return hasIndex
  }

  generateHtml = async (
    outputPath = "",
    scriptMountPath = "",
    htmlFile = "" as string | false
  ) => {
    const templateReplace = {
      __plasmo_static_index_title__: this.plasmoManifest.name,
      __plasmo_static_script__: scriptMountPath
    }

    return htmlFile
      ? this.#copyGenerate(htmlFile, outputPath, {
          ...templateReplace,
          "</body>": `<div id="root"></div><script src="${scriptMountPath}" type="module"></script></body>`
        })
      : this.#cachedGenerate("index.html", outputPath, templateReplace)
  }

  createPageHtml = async (
    uiPageName: ExtensionUIPage,
    htmlFile = "" as string | false
  ) => {
    const outputHtmlPath = resolve(
      this.commonPath.dotPlasmoDirectory,
      `${uiPageName}.html`
    )

    const scriptMountPath = `./static/${uiPageName}${this.mountExt}`

    return this.generateHtml(outputHtmlPath, scriptMountPath, htmlFile)
  }

  createPageMount = async (module: ParsedPath) => {
    vLog(`Creating page mount template for ${module.dir}`)
    const { dotPlasmoDirectory } = this.commonPath

    const staticModulePath = resolve(dotPlasmoDirectory, module.dir)
    const htmlPath = resolve(staticModulePath, `${module.name}.html`)
    await ensureDir(staticModulePath)

    const isUiExt = isSupportedUiExt(module.ext)

    if (isUiExt) {
      const scriptPath = resolve(
        staticModulePath,
        `${module.name}${this.mountExt}`
      )

      await Promise.all([
        this.#cachedGenerate(`index${this.mountExt}`, scriptPath, {
          __plasmo_import_module__: `~${toPosix(join(module.dir, module.name))}`
        }),
        this.generateHtml(htmlPath, `./${module.name}${this.mountExt}`)
      ])
    } else {
      await Promise.all([
        this.generateHtml(
          htmlPath,
          `~${toPosix(join(module.dir, module.name))}${module.ext}`
        )
      ])
    }

    return htmlPath
  }

  createContentScriptMount = async (module: ParsedPath) => {
    vLog(`Creating content script mount for ${module.dir}`)
    const staticModulePath = resolve(
      this.commonPath.staticDirectory,
      module.dir
    )

    await ensureDir(staticModulePath)

    const staticContentPath = resolve(
      staticModulePath,
      `${module.name}${this.mountExt}`
    )

    // Can pass metadata to check config for type of mount as well?
    await this.#cachedGenerate(
      `content-script-ui-mount${this.mountExt}`,
      staticContentPath,
      {
        __plasmo_mount_content_script__: `~${toPosix(
          join(module.dir, module.name)
        )}`
      }
    )

    return staticContentPath
  }

  #generate = async (
    templateContent: string,
    outputFilePath: string,
    replaceMap: Record<string, string>
  ) => {
    const finalScaffold = Object.entries(replaceMap).reduce(
      (html, [key, value]) => html.replaceAll(key, value),
      templateContent
    )

    await writeFile(outputFilePath, finalScaffold)
  }

  #copyGenerate = async (
    filePath: string,
    outputFilePath: string,
    replaceMap: Record<string, string>
  ) => {
    const templateContent = await readFile(filePath, "utf8")
    await this.#generate(templateContent, outputFilePath, replaceMap)
  }

  #cachedGenerate = async (
    fileName: string,
    outputFilePath: string,
    replaceMap: Record<string, string>
  ) => {
    if (!this.#scaffoldCache[fileName]) {
      this.#scaffoldCache[fileName] = await readFile(
        resolve(this.plasmoManifest.staticScaffoldPath, fileName),
        "utf8"
      )
    }

    await this.#generate(
      this.#scaffoldCache[fileName],
      outputFilePath,
      replaceMap
    )
  }

  #mirrorGenerate = async (
    fileName: string,
    staticModulePath: string,
    replaceMap: Record<string, string>
  ) =>
    this.#cachedGenerate(
      fileName,
      resolve(staticModulePath, fileName),
      replaceMap
    )
}
