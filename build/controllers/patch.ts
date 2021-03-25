import chalk from "chalk";
import execa from "execa";
import {
    ensureDirSync,
    existsSync,
    readFileSync,
    rmdirSync,
    rmSync,
    statSync,
    writeFileSync
} from "fs-extra";
import { resolve } from "path";
import readline from "readline";
import { log } from "..";
import {
    COMMON_DIR,
    PATCHES_DIR,
    PATCH_ARGS,
    SRC_DIR
} from "../constants";
import { copyManual } from "../utils";

class Patch {
    public name: string;
    public action: string;
    public src: string | string[];
    public type: "file" | "manual";
    public status: number[];
    public markers?: {
        [key: string]: [string, string];
    };
    public indent?: number;
    private _done: boolean = false;

    private error: Error | unknown;

    private async applyAsManual() {
        return new Promise(async (res, rej) => {
            try {
                switch (this.action) {
                    case "copy":
                        if (typeof this.src == "string") {
                            if (
                                !existsSync(
                                    resolve(
                                        COMMON_DIR,
                                        this.src
                                    )
                                )
                            )
                                return log.error(
                                    `We were unable to copy the file or directory \`${this.src}\` as it doesn't exist in the common directory.`
                                );

                            copyManual(this.src);
                        }

                        if (Array.isArray(this.src)) {
                            this.src.forEach((i) => {
                                if (
                                    !existsSync(
                                        resolve(
                                            COMMON_DIR,
                                            i
                                        )
                                    )
                                )
                                    return log.error(
                                        `We were unable to copy the file or directory \`${i}\` as it doesn't exist in the common directory.`
                                    );

                                if (
                                    statSync(
                                        i
                                    ).isDirectory()
                                ) {
                                    ensureDirSync(i);
                                }

                                copyManual(i);
                            });
                        }

                        break;
                    case "delete":
                        if (typeof this.src == "string") {
                            if (
                                !existsSync(
                                    resolve(
                                        SRC_DIR,
                                        this.src
                                    )
                                )
                            )
                                return log.error(
                                    `We were unable to delete the file or directory \`${this.src}\` as it doesn't exist in the src directory.`
                                );

                            if (
                                statSync(
                                    resolve(
                                        SRC_DIR,
                                        this.src
                                    )
                                ).isDirectory()
                            ) {
                                rmdirSync(
                                    resolve(
                                        SRC_DIR,
                                        this.src
                                    )
                                );
                            } else {
                                rmSync(
                                    resolve(
                                        SRC_DIR,
                                        this.src
                                    )
                                );
                            }
                        }

                        if (Array.isArray(this.src)) {
                            this.src.forEach((i) => {
                                if (
                                    !existsSync(
                                        resolve(
                                            SRC_DIR,
                                            i
                                        )
                                    )
                                )
                                    return log.error(
                                        `We were unable to delete the file or directory \`${i}\` as it doesn't exist in the src directory.`
                                    );

                                if (
                                    statSync(
                                        resolve(
                                            SRC_DIR,
                                            i
                                        )
                                    ).isDirectory()
                                ) {
                                    rmdirSync(
                                        resolve(
                                            SRC_DIR,
                                            i
                                        )
                                    );
                                } else {
                                    rmSync(
                                        resolve(
                                            SRC_DIR,
                                            i
                                        ),
                                        { force: true }
                                    );
                                }
                            });
                        }

                        break;
                    case "markers":
                        if (!this.markers)
                            return log.error(
                                `Unable to parse markers.`
                            );

                        if (typeof this.src == "string") {
                            const target = resolve(
                                COMMON_DIR,
                                this.src
                            );
                            const srcKey = Object.keys(
                                this.markers
                            )[0];
                            const srcTarget = resolve(
                                SRC_DIR,
                                srcKey
                            );

                            if (!existsSync(target))
                                log.error(
                                    `We were unable to process the file \`${this.src}\` as it does not exist in the common directory.`
                                );
                            if (
                                statSync(
                                    target
                                ).isDirectory()
                            )
                                log.error(
                                    `Src cannot be a directory.`
                                );

                            const content = readFileSync(
                                target,
                                "utf-8"
                            );
                            let srcContent = readFileSync(
                                srcTarget,
                                "utf-8"
                            );

                            const look = srcContent
                                .split(
                                    this.markers[
                                        srcKey
                                    ][0]
                                )[1]
                                .split(
                                    this.markers[
                                        srcKey
                                    ][1]
                                )[0];

                            srcContent = srcContent.replace(
                                look,
                                `\n${Array(
                                    this.indent
                                        ? this.indent
                                        : 0
                                ).join(
                                    "\t"
                                )}${content
                                    .split("\n")
                                    .join(
                                        "\n" +
                                            Array(
                                                this
                                                    .indent
                                                    ? this
                                                          .indent
                                                    : 0
                                            ).join("\t")
                                    )}\n${Array(
                                    this.indent
                                        ? this.indent
                                        : 0
                                ).join("\t")}`
                            );

                            writeFileSync(
                                srcTarget,
                                srcContent
                            );
                        } else {
                            log.error(
                                `Action "markers" cannot have src as an array.`
                            );
                        }

                        break;
                }

                res(true);
            } catch (e) {
                rej(e);
            }
        });
    }

    private async applyAsPatch() {
        return new Promise(async (res, rej) => {
            try {
                await execa(
                    "git",
                    [
                        "apply",
                        "-R",
                        ...PATCH_ARGS,
                        this.src as any
                    ],
                    { cwd: SRC_DIR }
                );

                const {
                    stdout,
                    exitCode
                } = await execa(
                    "git",
                    [
                        "apply",
                        ...PATCH_ARGS,
                        this.src as any
                    ],
                    { cwd: SRC_DIR }
                );

                if (exitCode == 0) res(true);
                else throw stdout;
            } catch (e) {
                rej(e);
            }
        });
    }

    public async apply() {
        log.info(
            `${chalk.gray(
                `(${this.status[0]}/${this.status[1]})`
            )} Applying ${this.name}...`
        );

        try {
            if (this.type == "manual")
                await this.applyAsManual();
            if (this.type == "file")
                await this.applyAsPatch();

            this.done = true;
        } catch (e) {
            this.error = e;
            this.done = false;
        }
    }

    public get done() {
        return this._done;
    }

    public set done(_: any) {
        this._done = _;

        readline.moveCursor(process.stdout, 0, -1);
        readline.clearLine(process.stdout, 1);

        log.info(
            `${chalk.gray(
                `(${this.status[0]}/${this.status[1]})`
            )} Applying ${this.name}... ${chalk[
                this._done ? "green" : "red"
            ].bold(this._done ? "Done ✔" : "Error ❗")}`
        );

        if (this.error) {
            throw this.error;
        }
    }

    constructor({
        name,
        action,
        src,
        type,
        status,
        markers,
        indent
    }: {
        name: string;
        action?: string;
        src?: string | string[];
        type: "file" | "manual";
        status: number[];
        markers?: {
            [key: string]: [string, string];
        };
        indent?: number;
    }) {
        this.name = name;
        this.action = action || "";
        this.src = src || resolve(PATCHES_DIR, name);
        this.type = type;
        this.status = status;
        this.markers = markers;
        this.indent = indent;
    }
}

export default Patch;