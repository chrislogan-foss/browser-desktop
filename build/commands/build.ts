import Docker from "dockerode";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { bin_name, log } from "..";
import {
    ARCHITECTURE,
    BUILD_TARGETS,
    CONFIGS_DIR,
    ENGINE_DIR
} from "../constants";
import { dispatch } from "../utils";

const platform: any = {
    win32: "windows",
    darwin: "macos",
    linux: "linux"
};

const applyConfig = (os: string, arch: string) => {
    log.info("Applying mozconfig...");

    const commonConfig = readFileSync(
        resolve(CONFIGS_DIR, "common", "mozconfig"),
        "utf-8"
    );

    const osConfig = readFileSync(
        resolve(
            CONFIGS_DIR,
            os,
            arch === "i686"
                ? "mozconfig-i686"
                : "mozconfig"
        ),
        "utf-8"
    );

    const mergedConfig = `# This file is automatically generated. You should only modify this if you know what you are doing!\n\n${commonConfig}\n\n${osConfig}`;

    writeFileSync(
        resolve(ENGINE_DIR, "mozconfig"),
        mergedConfig
    );

    log.info(`Config for this \`${os}\` build:`);

    mergedConfig.split("\n").map((ln) => {
        if (
            ln.startsWith("mk") ||
            ln.startsWith("ac") ||
            ln.startsWith("export")
        )
            log.info(
                `\t${ln
                    .replace(/mk_add_options /, "")
                    .replace(/ac_add_options /, "")
                    .replace(/export /, "")}`
            );
    });
};

const dockerBuild = async (os: string) => {
    const dockerfile = `configs/${os}/${os}.dockerfile`;
    const image_name = `db-${os}-build`;

    log.info(`Building Dockerfile for "${os}"...`);
    await dispatch("docker", [
        "build",
        `configs/${os}`,
        "-f",
        dockerfile,
        "-t",
        image_name
    ]);

    const docker = new Docker();

    const container = await docker.createContainer({
        Image: image_name,
        Tty: true,
        Volumes: {
            "/worker": {},
            "/worker/build": {}
        },
        HostConfig: {
            Binds: [
                `${ENGINE_DIR}:/worker/build`,
                `${resolve(process.cwd())}:/worker`
            ]
        }
    });

    container.attach(
        {
            stream: true,
            stdin: true,
            stdout: true,
            stderr: true
        },
        (e, out) => {
            if (out) out.pipe(process.stdout);
        }
    );

    await container.start();
    await container.wait();
};

const genericBuild = async (os: string) => {
    log.info(`Building for "${os}"...`);

    log.warning(
        `If you get any dependency errors, try running |${bin_name} bootstrap|.`
    );

    await dispatch(`./mach`, ["build"], ENGINE_DIR);
};

const parseDate = (d: number) => {
    d = d / 1000;
    var h = Math.floor(d / 3600);
    var m = Math.floor((d % 3600) / 60);
    var s = Math.floor((d % 3600) % 60);

    var hDisplay =
        h > 0
            ? h + (h == 1 ? " hour, " : " hours, ")
            : "";
    var mDisplay =
        m > 0
            ? m + (m == 1 ? " minute, " : " minutes, ")
            : "";
    var sDisplay =
        s > 0
            ? s + (s == 1 ? " second" : " seconds")
            : "";
    return hDisplay + mDisplay + sDisplay;
};

const success = (date: number) => {
    // mach handles the success messages
    console.log();
    log.info(
        `Total build time: ${parseDate(
            Date.now() - date
        )}.`
    );
};

interface Options {
    arch: string;
}

export const build = async (
    os: string,
    options: Options
) => {
    let d = Date.now();

    if (os) {
        // Docker build

        let arch = "64bit";

        if (!BUILD_TARGETS.includes(os))
            return log.error(
                `We do not support "${os}" builds right now.\nWe only currently support ${JSON.stringify(
                    BUILD_TARGETS
                )}.`
            );

        if (options.arch) {
            if (!ARCHITECTURE.includes(options.arch))
                return log.error(
                    `We do not support "${
                        options.arch
                    }" build right now.\nWe only currently support ${JSON.stringify(
                        ARCHITECTURE
                    )}.`
                );
            else arch = options.arch;
        }

        applyConfig(os, options.arch);

        setTimeout(async () => {
            await dockerBuild(os).then((_) => success(d));
        }, 2500);
    } else {
        // Host build

        const prettyHost =
            platform[process.platform as any];

        if (BUILD_TARGETS.includes(prettyHost)) {
            let arch = "64bit";

            if (options.arch) {
                if (!ARCHITECTURE.includes(options.arch))
                    return log.error(
                        `We do not support "${
                            options.arch
                        }" build right now.\nWe only currently support ${JSON.stringify(
                            ARCHITECTURE
                        )}.`
                    );
                else arch = options.arch;
            }

            applyConfig(prettyHost, options.arch);

            setTimeout(async () => {
                await genericBuild(prettyHost).then((_) =>
                    success(d)
                );
            }, 2500);
        } else {
            return log.error(
                `We do not support "${prettyHost}" builds right now.\nWe only currently support ${JSON.stringify(
                    BUILD_TARGETS
                )}.`
            );
        }
    }
};
