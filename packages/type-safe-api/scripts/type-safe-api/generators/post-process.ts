/*! Copyright [Amazon.com](http://amazon.com/), Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */
import * as fs from "fs";
import * as path from "path";
import kebabCase from "lodash/kebabCase";
import camelCase from "lodash/camelCase";
import { parse } from "ts-command-line-args";

// Used to split OpenAPI generated files into multiple files in order to work around
// the restrictions around file naming and splitting in OpenAPI generator
const TSAPI_SPLIT_FILE_HEADER = "###TSAPI_SPLIT_FILE###";
const TSAPI_WRITE_FILE_START = "###TSAPI_WRITE_FILE###";
const TSAPI_WRITE_FILE_END = "###/TSAPI_WRITE_FILE###";

interface WriteFileConfig {
  readonly dir: string;
  readonly name: string;
  readonly ext: string;
  readonly overwrite?: boolean;
  readonly kebabCaseFileName?: boolean;
}

// Delimiters for applying functions
const TSAPI_FUNCTION_START = "###TSAPI_FN###";
const TSAPI_FUNCTION_END = "###/TSAPI_FN###";

interface FunctionConfig {
  readonly function: string;
  readonly args: any[];
}

const applyReplacementFunction = (functionConfig: FunctionConfig): string => {
  switch (functionConfig.function) {
    case "kebabCase":
      return kebabCase(functionConfig.args[0]);
    case "camelCase":
      return camelCase(functionConfig.args[0]);
    default:
      throw new Error(`Unsupported TSAPI_FN function ${functionConfig.function}`);
  }
};

const applyReplacementFunctions = (fileContents: string): string => {
  return fileContents.split(TSAPI_FUNCTION_START)
    .map((part) => {
      if (part.includes(TSAPI_FUNCTION_END)) {
        const [functionConfig, restOfFile] = part.split(TSAPI_FUNCTION_END);
        return `${applyReplacementFunction(JSON.parse(functionConfig))}${restOfFile}`;
      }
      return part;
    })
    .join('');
};

interface Arguments {
  /**
   * Path to the directory containing output files
   */
  readonly outputPath: string;
  /**
   * Path to the source directory relative to the output directory
   */
  readonly srcDir: string;
}

void (async () => {
  const args = parse<Arguments>({
    outputPath: { type: String },
    srcDir: { type: String },
  });

  // OpenAPI generator writes a manifest called FILES which lists the files it generated.
  const openApiGeneratedFilesManifestPath = path.join(
    args.outputPath,
    ".openapi-generator",
    "FILES"
  );

  // Read the file paths from the manifest
  const generatedFiles = fs
    .readFileSync(openApiGeneratedFilesManifestPath, { encoding: "utf-8" })
    .split("\n")
    .filter((x) => x);

  const additionalGeneratedFiles: string[] = [];

  // Loop over generated files
  generatedFiles.forEach((generatedFile) => {
    const filePath = path.join(args.outputPath, generatedFile);

    if (fs.existsSync(filePath)) {
      const contents = fs.readFileSync(filePath, "utf-8");

      if (contents.startsWith(TSAPI_SPLIT_FILE_HEADER)) {
        // Split by the start template
        contents
          .split(TSAPI_WRITE_FILE_START)
          .filter((t) => t.includes(TSAPI_WRITE_FILE_END))
          .forEach((destinationFileTemplate) => {
            // Split by the end template to receive the file path, and contents
            const [configString, newFileContents] =
              destinationFileTemplate.split(TSAPI_WRITE_FILE_END);
            const config = JSON.parse(configString) as WriteFileConfig;

            const newFileName = `${
              config.kebabCaseFileName ? kebabCase(config.name) : config.name
            }${config.ext}`;
            const relativeNewFileDir = path.join(args.srcDir, config.dir);
            const relativeNewFilePath = path.join(
              relativeNewFileDir,
              newFileName
            );
            const newFilePath = path.join(args.outputPath, relativeNewFilePath);

            // Write to the instructed file path (relative to the src dir)
            if (!fs.existsSync(newFilePath) || config.overwrite) {
              // Create it's containing directory if needed
              fs.mkdirSync(path.join(args.outputPath, relativeNewFileDir), {
                recursive: true,
              });
              fs.writeFileSync(newFilePath, applyReplacementFunctions(newFileContents));

              // Overwritten files are added to the manifest so that they can be cleaned up
              // by clean-openapi-generated-code
              if (config.overwrite) {
                additionalGeneratedFiles.push(relativeNewFilePath);
              }
            }
          });

        // Delete the original file
        fs.rmSync(filePath);
      } else {
        // Apply the replacement functions directly
        fs.writeFileSync(filePath, applyReplacementFunctions(contents));
      }
    }
  });

  // Update the manifest with any overwritten files
  fs.writeFileSync(
    openApiGeneratedFilesManifestPath,
    [...generatedFiles, ...additionalGeneratedFiles].join("\n")
  );
})();
