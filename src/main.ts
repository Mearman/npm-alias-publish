import * as core from '@actions/core'
import exec from '@actions/exec'
import glob from '@actions/glob'
import fs from 'fs'
import path from 'path'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const scopeFrom = core.getInput('from', {
      required: true,
      trimWhitespace: true
    })
    const scopeTo = core.getInput('to', {
      required: true,
      trimWhitespace: true
    })
    const version = core.getInput('version', {
      required: true,
      trimWhitespace: true
    })
    const dirPatternRescope = core.getMultilineInput(
      'directories_to_rescope'
    ) ?? ['./']
    const prePublishCommands =
      core.getMultilineInput('pre_publish_commands') ?? []
    const dependencyTypes = core.getMultilineInput('dependency_types') ?? [
      'dependencies',
      'devDependencies',
      'peerDependencies'
    ]
    const dirPatternToPublish = core.getMultilineInput(
      'directories_to_publish'
    ) ?? ['./']
    const publishFlags = core.getMultilineInput('publish_flags') ?? []

    const rescopeDirs = (
      await (
        await glob.create(dirPatternRescope.join('\n'), {
          matchDirectories: true
        })
      ).glob()
    ).filter(directory => fs.lstatSync(directory).isDirectory())
    console.log({ directories: rescopeDirs })

    console.log('='.repeat(80))
    console.log('Rescoping packages')
    for (const directory of rescopeDirs) {
      console.log('='.repeat(80))
      const packageJsonPath = checkPackageDir(directory)
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      const currentPackageName = packageJson.name
      console.log(directory, currentPackageName)

      const newPackageName = currentPackageName.replace(scopeFrom, scopeTo)
      console.log(
        `package.json.name: ${currentPackageName} -> ${newPackageName}`
      )
      packageJson.name = newPackageName

      for (const dependencyType of dependencyTypes) {
        if (packageJson[dependencyType]) {
          for (const [dep, depVersion] of Object.entries(
            packageJson[dependencyType]
          )) {
            if (dep.startsWith(scopeFrom)) {
              const newVersion = `npm:${dep.replace(scopeFrom, scopeTo)}@${version}`
              console.log(
                `${currentPackageName}.${dependencyType}.${dep}: ${depVersion} -> ${newVersion}`
              )
              packageJson[dependencyType][dep] = newVersion
            }
          }
        }
      }

      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))
    }

    const publishDirs = (
      await (
        await glob.create(dirPatternToPublish.join('\n'), {
          matchDirectories: true
        })
      ).glob()
    ).filter(directory => fs.lstatSync(directory).isDirectory())

    console.log('='.repeat(80))
    console.log('Updating rescoped packages in packages to be published')
    for (const directory of publishDirs) {
      console.log('='.repeat(80))
      const packageJsonPath = checkPackageDir(directory)
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      const currentPackageName = packageJson.name
      console.log(directory, currentPackageName)

      for (const dependencyType of dependencyTypes) {
        if (packageJson[dependencyType]) {
          for (const [dep, depVersion] of Object.entries(
            packageJson[dependencyType]
          )) {
            if (dep.startsWith(scopeFrom)) {
              const newVersion = `npm:${dep.replace(scopeFrom, scopeTo)}@${version}`
              console.log(
                `${currentPackageName}.${dependencyType}.${dep}: ${depVersion} -> ${newVersion}`
              )
              packageJson[dependencyType][dep] = newVersion
            }
          }
        }
      }
    }

    console.log('='.repeat(80))
    console.log('Running pre-publish commands')
    for (const directory of publishDirs) {
      console.log('='.repeat(80))
      console.log(`Running pre-publish commands in ${directory}`)
      for (const command of prePublishCommands) {
        await exec.exec(command, [], { cwd: directory })
      }
    }

    console.log('='.repeat(80))
    console.log('Publishing packages')
    for (const directory of publishDirs) {
      console.log('='.repeat(80))
      console.log(`Publishing in ${directory}`)
      await exec.exec('npm', ['publish', ...publishFlags], { cwd: directory })
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error)
  }
}
function checkPackageDir(directory: string) {
  if (!(fs.existsSync(directory) && fs.lstatSync(directory).isDirectory())) {
    throw new Error(`The directory ${directory} does not exist.`)
  }
  const packageJsonPath = path.join(directory, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(
      `The directory ${directory} does not contain a package.json.`
    )
  }
  return packageJsonPath
}
