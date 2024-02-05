import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'
import * as fs from 'fs'
import * as path from 'path'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const failOnNonPackageDir =
      core.getBooleanInput('fail_on_non_package_dir', {
        required: true
      }) ?? true

    const scopeFrom = core.getInput('from', {
      required: true,
      trimWhitespace: true
    })

    const scopeTo = core.getInput('to', {
      required: true,
      trimWhitespace: true
    })

    const dirPattern = core.getMultilineInput('directories') ?? ['./']

    const prePublishCommands =
      core.getMultilineInput('pre_publish_commands') ?? []

    const dependencyTypes = core.getMultilineInput('dependency_types') ?? [
      'dependencies',
      'devDependencies',
      'peerDependencies'
    ]

    const publishFlags = core.getMultilineInput('publish_flags') ?? []

    const directories = (
      await (
        await glob.create(dirPattern.join('\n'), {
          matchDirectories: true,
          implicitDescendants: false
        })
      ).glob()
    ).filter(directory => fs.lstatSync(directory).isDirectory())

    console.log({ directories: directories })

    spacer()
    await exec.exec('npm', ['install'])
    spacer()

    console.log('Rescoping packages')
    for (const directory of directories) {
      spacer()
      const packageJsonPath = checkPackageDir(directory, failOnNonPackageDir)
      if (!packageJsonPath) continue
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      const currentPackageName = packageJson.name
      console.log(directory, currentPackageName)

      const newPackageName = currentPackageName.replace(scopeFrom, scopeTo)
      console.log(`package name: ${currentPackageName} -> ${newPackageName}`)
      packageJson.name = newPackageName
      packageJson.version = newVersion()

      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))
      await publish(prePublishCommands, directory, publishFlags)
    }

    spacer()
    await exec.exec('npm', ['install'])
    spacer()

    console.log('Updating rescoped packages in packages to be published')
    for (const directory of directories) {
      spacer()
      const packageJsonPath = checkPackageDir(directory, failOnNonPackageDir)
      if (!packageJsonPath) continue
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      const currentPackageName = packageJson.name
      console.log(directory, currentPackageName)
      packageJson.version = newVersion()

      for (const dependencyType of dependencyTypes) {
        if (packageJson[dependencyType]) {
          for (const [dep, depVersion] of Object.entries(
            packageJson[dependencyType]
          )) {
            if (dep.startsWith(scopeFrom)) {
              const packageAlias = `npm:${dep.replace(scopeFrom, scopeTo)}@*`
              console.log(
                `${dependencyType}.${dep}: ${depVersion} -> ${packageAlias}`
              )
              packageJson[dependencyType][dep] = packageAlias
            }
          }
        }
      }
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))
      await publish(prePublishCommands, directory, publishFlags)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error)
  }
}
function spacer({
  char = '=',
  count = 80
}: { char?: string; count?: number } = {}) {
  console.log(char.repeat(count))
}

function newVersion() {
  const now = new Date()
  const version = `${now.getUTCFullYear()}.${now.getUTCMonth()}.${now.getUTCDate()}-${now.getUTCHours()}${now.getUTCMinutes()}${now.getUTCSeconds()}`
  return version
}

async function publish(
  prePublishCommands: string[],
  directory: string,
  publishFlags: string[]
) {
  spacer({ count: 10 })
  console.log('Running pre-publish commands')
  for (const command of prePublishCommands) {
    await exec.exec(command, [], { cwd: directory })
  }
  spacer({ count: 10 })
  console.log('Publishing package')
  await exec.exec('npm', ['publish', ...publishFlags], { cwd: directory })
}

function checkPackageDir(
  directory: string,
  failOnNonPackageDir: boolean = true
) {
  if (!(fs.existsSync(directory) && fs.lstatSync(directory).isDirectory())) {
    throw new Error(`The directory ${directory} does not exist.`)
  }
  const packageJsonPath = path.join(directory, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    if (failOnNonPackageDir) {
      throw new Error(
        `The directory ${directory} does not contain a package.json.`
      )
    } else {
      console.log(
        `The directory ${directory} does not contain a package.json. Skipping.`
      )
      return null
    }
  }
  return packageJsonPath
}
